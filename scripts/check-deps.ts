#!/usr/bin/env bun
/**
 * Dependency-direction check (docs/design/repo-layout.md, CLAUDE.md).
 *
 * `core` imports nothing from siblings; `api`/`cli` import downward only; the
 * `web -> api` edge is type-only, so it must vanish under type erasure.
 *
 * Two views of every file:
 *   - every specifier it mentions  — a regex over the source, so `import type`
 *     counts. This is what "may this package know about that one at all?" needs.
 *   - the specifiers that survive type erasure — Bun's transpiler, which is the
 *     same erasure a bundler performs. This is what "type-only edge" needs.
 *
 * The regex deliberately does not understand strings, so a banned specifier
 * written inside a string literal is reported. That direction of error is loud
 * and cheap to fix; the opposite direction would let a violation through.
 */

import { stat } from 'node:fs/promises'

/** Defaults to the repo root; `--root <dir>` points the same rules at a fixture tree. */
const ROOT = (() => {
  const flag = process.argv.indexOf('--root')
  if (flag !== -1 && process.argv[flag + 1] !== undefined) {
    return (process.argv[flag + 1] as string).replace(/\/$/, '')
  }
  return new URL('..', import.meta.url).pathname.replace(/\/$/, '')
})()

type EdgeKind = 'value' | 'type'

type Package = {
  readonly name: string
  readonly dir: string
}

const PACKAGES: readonly Package[] = [
  { name: '@retro/core', dir: 'packages/core' },
  { name: '@retro/api', dir: 'apps/api' },
  { name: '@retro/cli', dir: 'apps/cli' },
  { name: '@retro/web', dir: 'apps/web' },
]

/**
 * The complete set of edges permitted between workspace packages. Anything not
 * listed here is a violation. Change this table only with the layout doc.
 *
 * `cli -> api` exists because the compiled binary carries the server: `retro
 * serve` starts it in-process. `cli` still reaches the domain through
 * `core`, never through the server.
 */
const ALLOWED_EDGES: Readonly<Record<string, Readonly<Record<string, EdgeKind>>>> = {
  '@retro/core': {},
  '@retro/api': { '@retro/core': 'value' },
  '@retro/cli': { '@retro/core': 'value', '@retro/api': 'value' },
  '@retro/web': { '@retro/api': 'type' },
}

/**
 * Skipped wherever they appear: tooling output that can nest anywhere.
 */
const IGNORED_SEGMENTS = [
  'node_modules',
  '.features-gen',
  'test-results',
  'playwright-report',
  'blob-report',
]

/**
 * Build output, skipped **only at a package root**.
 *
 * Bundled output is not source: scanning it would report the bundler's own
 * `new Response` and every dependency's internals as violations of rules about
 * our code. But matching the name at any depth would hide real source — a file
 * under `apps/web/src/dist-mocked/` is something someone wrote, and the checks
 * exist precisely to read it.
 */
const IGNORED_ROOTS = ['dist', 'dist-mocked']

/** `entry` is relative to the package (or web) root being scanned. */
function isIgnored(entry: string): boolean {
  const segments = entry.split('/')
  if (segments.some((segment) => IGNORED_SEGMENTS.includes(segment))) return true
  return IGNORED_ROOTS.includes(segments[0] ?? '')
}

const GENERATED_FILES = ['routeTree.gen.ts']

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts']

type Reference = {
  readonly specifier: string
  readonly line: number
}

type Violation = {
  readonly file: string
  readonly line: number
  readonly message: string
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function collectSourceFiles(dir: string): Promise<string[]> {
  const files: string[] = []
  if (!(await isDirectory(dir))) return files
  for await (const entry of new Bun.Glob('**/*').scan({ cwd: dir, onlyFiles: true, dot: false })) {
    if (isIgnored(entry)) continue
    if (GENERATED_FILES.includes(entry.split('/').at(-1) ?? '')) continue
    if (!SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension))) continue
    files.push(`${dir}/${entry}`)
  }
  return files.sort()
}

/** Strips block comments and whole-line `//` comments; leaves string literals alone. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

const SPECIFIER_PATTERN =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g

function referencedSpecifiers(source: string): Reference[] {
  const stripped = stripComments(source)
  const references: Reference[] = []
  for (const match of stripped.matchAll(SPECIFIER_PATTERN)) {
    const specifier = match[1]
    if (specifier === undefined) continue
    const line = stripped.slice(0, match.index).split('\n').length
    references.push({ specifier, line })
  }
  return references
}

/**
 * Every file is parsed as TSX, `.ts` and `.tsx` alike, because one loader keeps
 * the two views of a file consistent.
 *
 * The cost: in TSX a generic arrow function is ambiguous with a JSX element, so
 * `const f = async <T>(x: T) => …` fails to parse — and the error names the
 * transpiler and a line in `input.tsx`, not the file it came from, which reads
 * like a bug in this script rather than in the source. Write a `function`
 * declaration instead; it is unambiguous and the check goes quiet. (`<T,>` also
 * disambiguates, if an arrow is genuinely wanted.)
 */
const transpiler = new Bun.Transpiler({ loader: 'tsx' })

/**
 * A leading `#!/usr/bin/env bun` is legal in an entry point and fatal to the
 * transpiler, which reports it as a parse error in `input.tsx` — a message that
 * names neither the file nor the shebang. Dropping the line keeps every other
 * line number intact, so a real parse error still points where it should.
 */
function withoutShebang(source: string): string {
  if (!source.startsWith('#!')) return source
  const firstNewline = source.indexOf('\n')
  // Blanked, not removed: every following line keeps its number, so a genuine
  // parse error still points where it should.
  return firstNewline === -1 ? '' : source.slice(firstNewline)
}

/** Specifiers that survive type erasure — i.e. real runtime dependencies. */
function runtimeSpecifiers(source: string): Set<string> {
  return new Set(transpiler.scanImports(withoutShebang(source)).map((entry) => entry.path))
}

function workspaceTarget(specifier: string): string | undefined {
  return PACKAGES.map((pkg) => pkg.name).find(
    (name) => specifier === name || specifier.startsWith(`${name}/`),
  )
}

function escapesPackage(file: string, packageDir: string, specifier: string): boolean {
  if (!specifier.startsWith('.')) return false
  const fileDir = file.slice(0, file.lastIndexOf('/'))
  const resolved = new URL(specifier, `file://${fileDir}/`).pathname
  return !resolved.startsWith(`${ROOT}/${packageDir}/`)
}

async function checkPackage(pkg: Package): Promise<{ violations: Violation[]; scanned: number }> {
  const allowed = ALLOWED_EDGES[pkg.name] ?? {}
  const violations: Violation[] = []
  const files = await collectSourceFiles(`${ROOT}/${pkg.dir}`)

  for (const file of files) {
    const source = await Bun.file(file).text()
    const references = referencedSpecifiers(source)
    const runtime = runtimeSpecifiers(source)
    const relative = file.slice(ROOT.length + 1)

    for (const { specifier, line } of references) {
      if (escapesPackage(file, pkg.dir, specifier)) {
        violations.push({
          file: relative,
          line,
          message: `relative import '${specifier}' escapes ${pkg.dir}/ — cross-package imports go through the barrel`,
        })
        continue
      }

      const target = workspaceTarget(specifier)
      if (target === undefined || target === pkg.name) continue

      const edge = allowed[target]
      if (edge === undefined) {
        violations.push({
          file: relative,
          line,
          message: `${pkg.name} must not import ${target} (no such edge in ALLOWED_EDGES)`,
        })
        continue
      }

      if (edge === 'type' && runtime.has(specifier)) {
        violations.push({
          file: relative,
          line,
          message: `${pkg.name} -> ${target} is a type-only edge; '${specifier}' survives type erasure. Use \`import type\`.`,
        })
      }
    }
  }

  return { violations, scanned: files.length }
}

const results = await Promise.all(PACKAGES.map(checkPackage))
const violations = results.flatMap((result) => result.violations)
const scanned = results.reduce((total, result) => total + result.scanned, 0)

if (violations.length > 0) {
  console.error(`dependency-direction: FAIL — ${violations.length} violation(s)`)
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}  ${violation.message}`)
  }
  process.exit(1)
}

console.log(
  `dependency-direction: OK — ${scanned} source file(s) across ${PACKAGES.length} packages`,
)
