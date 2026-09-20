#!/usr/bin/env bun
/**
 * R-MOCK-LOCK enforcement, layer 2 (docs/design/testing.md §R-MOCK-LOCK).
 *
 * In `apps/web`, tRPC is mocked only by one module typed from `AppRouter`:
 * `apps/web/test/trpc-mock.ts`. Nothing under `apps/web` may define a second
 * mock, a router, a request handler, or a fetch interceptor.
 *
 * Layer 1 is the compiler (`satisfies MockRouter`, type-only `web -> api`).
 * Layer 3 is human review, which catches what no regex can — a step that
 * reaches past the tRPC client, or a response literal invented rather than
 * derived from `inferRouterOutputs`.
 *
 * This script is layer 2 and nothing more: it is a text scan, and it is meant
 * to be noisy rather than clever.
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

const WEB_DIR = 'apps/web'

/** The one and only mock module. */
const MOCK_MODULE = 'apps/web/test/trpc-mock.ts'

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

const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']

/** Import specifiers no file under apps/web may name. */
const BANNED_SPECIFIERS: readonly (readonly [RegExp, string])[] = [
  [/^@trpc\/server(\/.*)?$/, 'tRPC server code has no business in a browser SPA'],
  [/^msw(\/.*)?$/, 'HTTP-level mocking is banned; mock the router, not the wire'],
  [/^@mswjs\/interceptors(\/.*)?$/, 'request interception is banned'],
  [/^nock$/, 'HTTP-level mocking is banned'],
  [/^undici$/, 'HTTP-level mocking is banned'],
  [/^node:https?$/, 'apps/web is a browser SPA; no HTTP server or interceptor here'],
]

/** Source patterns that mean "someone built a second mock". */
const BANNED_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/\binitTRPC\b/, 'defines a tRPC router'],
  [/\bcreateTRPCRouter\b/, 'defines a tRPC router'],
  [/\bsetupServer\s*\(/, 'installs an HTTP request handler'],
  [/\bsetupWorker\s*\(/, 'installs an HTTP request handler'],
  [/\bpage\.route\s*\(/, 'intercepts network requests in the browser'],
  [/\bcontext\.route\s*\(/, 'intercepts network requests in the browser'],
  [/\broute\.fulfill\s*\(/, 'fulfils an intercepted request with a response literal'],
  [/\b(?:globalThis|window|global)\s*\.\s*fetch\s*=/, 'replaces fetch'],
  [/\bnew\s+Response\s*\(/, 'hand-builds an HTTP response'],
]

/** Any of these in a filename claims to be a mock. Only MOCK_MODULE may. */
const MOCK_FILENAME = /(^|[.-])(mock|mocks|stub|stubs|fixture-server|handlers)([.-]|$)/i

type Finding = {
  readonly file: string
  readonly line: number
  readonly message: string
}

async function scannedFiles(): Promise<string[]> {
  const files: string[] = []
  const cwd = `${ROOT}/${WEB_DIR}`
  try {
    if (!(await stat(cwd)).isDirectory()) return files
  } catch {
    return files
  }
  for await (const entry of new Bun.Glob('**/*').scan({ cwd, onlyFiles: true, dot: false })) {
    if (isIgnored(entry)) continue
    if (GENERATED_FILES.includes(entry.split('/').at(-1) ?? '')) continue
    if (!SCANNED_EXTENSIONS.some((extension) => entry.endsWith(extension))) continue
    files.push(`${WEB_DIR}/${entry}`)
  }
  return files.sort()
}

const SPECIFIER_PATTERN =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length
}

const files = await scannedFiles()
const findings: Finding[] = []
const mockModules: string[] = []

for (const file of files) {
  const source = await Bun.file(`${ROOT}/${file}`).text()
  const basename = file.split('/').at(-1) ?? ''

  if (MOCK_FILENAME.test(basename.replace(/\.[^.]+$/, ''))) {
    mockModules.push(file)
  }

  for (const match of source.matchAll(SPECIFIER_PATTERN)) {
    const specifier = match[1]
    if (specifier === undefined) continue
    for (const [pattern, why] of BANNED_SPECIFIERS) {
      if (pattern.test(specifier)) {
        findings.push({
          file,
          line: lineOf(source, match.index),
          message: `imports '${specifier}' — ${why}`,
        })
      }
    }
  }

  for (const [pattern, why] of BANNED_PATTERNS) {
    const global = new RegExp(pattern.source, `${pattern.flags}g`)
    for (const match of source.matchAll(global)) {
      findings.push({
        file,
        line: lineOf(source, match.index),
        message: `${why} (\`${match[0]}\`)`,
      })
    }
  }
}

for (const module of mockModules) {
  if (module !== MOCK_MODULE) {
    findings.push({
      file: module,
      line: 1,
      message: `second mock module — R-MOCK-LOCK allows exactly one: ${MOCK_MODULE}`,
    })
  }
}

if (findings.length > 0) {
  console.error(`mock-lock: FAIL — ${findings.length} violation(s)`)
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line}  ${finding.message}`)
  }
  console.error('  See docs/design/testing.md §R-MOCK-LOCK.')
  process.exit(1)
}

const mockState =
  mockModules.length === 0
    ? `no mock module yet (${MOCK_MODULE} is not present)`
    : `single mock module: ${MOCK_MODULE}`
console.log(`mock-lock: OK — ${files.length} file(s) scanned under ${WEB_DIR}/, ${mockState}`)
