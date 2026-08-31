import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * A gate that cannot fail is worse than no gate. These run the real enforcement
 * scripts against fixture trees and assert both directions: the violation is
 * caught, and the legal shape next to it is not.
 */

const CHECK_DEPS = join(import.meta.dir, 'check-deps.ts')
const CHECK_MOCK_LOCK = join(import.meta.dir, 'check-mock-lock.ts')
const REPO_ROOT = join(import.meta.dir, '..')
const BIOME = join(REPO_ROOT, 'node_modules', '.bin', 'biome')

/** Badly formatted on purpose: biome would collapse the array onto one line. */
const UNFORMATTED_JSON = '{\n  "enabledMcpjsonServers": [\n    "shadcn"\n  ]\n}\n'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'retro-gate-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function writeFile(relativePath: string, contents: string): Promise<void> {
  await Bun.write(join(root, relativePath), contents)
}

async function spawn(
  command: string[],
  cwd?: string,
): Promise<{ exitCode: number; output: string }> {
  const proc = Bun.spawn(command, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { exitCode, output: `${stdout}${stderr}` }
}

function run(script: string): Promise<{ exitCode: number; output: string }> {
  return spawn(['bun', 'run', script, '--root', root])
}

/** Biome writes colour even into a pipe; the assertions are about the words. */
function stripStyling(output: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are the thing being stripped.
  return output.replace(/\[[0-9;]*m/g, '')
}

/**
 * Runs biome over a fixture tree under the shipped `files.includes`.
 *
 * The config is relocated rather than pointed at with `--config-path`, because
 * biome anchors a root-relative pattern like `!.claude` to the directory the
 * config lives in. Pointing at the repo would anchor the patterns at the repo
 * and the fixture would prove nothing.
 */
async function runBiome(cwd: string = root): Promise<{ exitCode: number; output: string }> {
  const config = JSON.parse(await Bun.file(join(REPO_ROOT, 'biome.json')).text())
  config.$schema = undefined
  config.vcs = { enabled: false }
  await Bun.write(join(cwd, 'biome.json'), JSON.stringify(config, null, 2))
  // The relocated config is re-serialized, so format it before it gets linted as
  // part of the tree — the rules under test are the includes, not this file.
  await spawn([BIOME, 'format', '--write', 'biome.json'], cwd)
  return spawn([BIOME, 'ci', '.'], cwd)
}

describe('check-deps', () => {
  test('accepts the legal edges', async () => {
    await writeFile('apps/api/src/index.ts', "import { CORE_VERSION } from '@retro/core'\n")
    await writeFile('apps/cli/src/index.ts', "import { CORE_VERSION } from '@retro/core'\n")
    await writeFile('apps/web/src/main.tsx', "import type { AppRouter } from '@retro/api'\n")
    await writeFile('packages/core/src/index.ts', "export const CORE_VERSION = '0.0.0'\n")

    const { exitCode, output } = await run(CHECK_DEPS)

    expect(output).toContain('dependency-direction: OK')
    expect(exitCode).toBe(0)
  })

  test('rejects core importing a sibling', async () => {
    await writeFile('packages/core/src/index.ts', "import { apiInfo } from '@retro/api'\n")

    const { exitCode, output } = await run(CHECK_DEPS)

    expect(output).toContain('@retro/core must not import @retro/api')
    expect(exitCode).toBe(1)
  })

  test('rejects a value import on the type-only web -> api edge', async () => {
    await writeFile('apps/web/src/main.tsx', "import { appRouter } from '@retro/api'\n")

    const { exitCode, output } = await run(CHECK_DEPS)

    expect(output).toContain('survives type erasure')
    expect(exitCode).toBe(1)
  })

  test('rejects web reaching into core, even type-only', async () => {
    await writeFile('apps/web/src/main.tsx', "import type { Record } from '@retro/core'\n")

    const { exitCode, output } = await run(CHECK_DEPS)

    expect(output).toContain('@retro/web must not import @retro/core')
    expect(exitCode).toBe(1)
  })

  test('reads a file with a shebang instead of failing to parse it', async () => {
    // An entry point may open with `#!/usr/bin/env bun`, which the tsx loader
    // rejects — and reports as a parse error in `input.tsx`, naming neither the
    // file nor the shebang. That cost a gate cycle in item 4. Both directions
    // matter here: the legal file passes, and the violation below it is still
    // caught, so the fix cannot have turned the check off for shebang files.
    await writeFile(
      'apps/cli/src/bin.ts',
      "#!/usr/bin/env bun\nimport { CORE_VERSION } from '@retro/core'\nexport default CORE_VERSION\n",
    )

    const { exitCode, output } = await run(CHECK_DEPS)

    expect(output).toContain('dependency-direction: OK')
    expect(output).not.toContain('Unexpected')
    expect(exitCode).toBe(0)
  })

  test('still checks a file that opens with a shebang', async () => {
    await writeFile(
      'packages/core/src/bin.ts',
      "#!/usr/bin/env bun\nimport { apiInfo } from '@retro/api'\nexport default apiInfo\n",
    )

    const { exitCode, output } = await run(CHECK_DEPS)

    expect(output).toContain('@retro/core must not import @retro/api')
    expect(exitCode).toBe(1)
  })

  test('skips the package’s own build output', async () => {
    await writeFile('apps/web/dist/assets/bundle.js', "import { appRouter } from '@retro/api'\n")
    await writeFile('apps/web/dist-mocked/assets/bundle.js', "import { x } from '@retro/core'\n")

    const { exitCode, output } = await run(CHECK_DEPS)

    expect(output).toContain('dependency-direction: OK')
    expect(exitCode).toBe(0)
  })

  test('still reads source that merely lives in a directory named like build output', async () => {
    // `dist`/`dist-mocked` are ignored at a package root because bundled output
    // is not source. Matching the name at any depth would hide real source: this
    // file is something someone wrote, and the check exists to read it.
    await writeFile('apps/web/src/dist-mocked/main.tsx', "import { appRouter } from '@retro/api'\n")

    const { exitCode, output } = await run(CHECK_DEPS)

    expect(output).toContain('survives type erasure')
    expect(exitCode).toBe(1)
  })

  test('rejects a relative import that escapes its package', async () => {
    await writeFile('apps/api/src/index.ts', "export * from '../../../packages/core/src/index'\n")

    const { exitCode, output } = await run(CHECK_DEPS)

    expect(output).toContain('escapes apps/api/')
    expect(exitCode).toBe(1)
  })
})

describe('check-mock-lock', () => {
  test('accepts apps/web with the single typed mock module', async () => {
    await writeFile(
      'apps/web/test/trpc-mock.ts',
      "import type { AppRouter } from '@retro/api'\nexport type Mock = AppRouter\n",
    )

    const { exitCode, output } = await run(CHECK_MOCK_LOCK)

    expect(output).toContain('mock-lock: OK')
    expect(output).toContain('single mock module')
    expect(exitCode).toBe(0)
  })

  test('rejects a second mock module', async () => {
    await writeFile('apps/web/test/trpc-mock.ts', 'export const mock = {}\n')
    await writeFile('apps/web/src/lib/session-mock.ts', 'export const other = {}\n')

    const { exitCode, output } = await run(CHECK_MOCK_LOCK)

    expect(output).toContain('second mock module')
    expect(exitCode).toBe(1)
  })

  test('rejects a hand-rolled router in the web package', async () => {
    await writeFile('apps/web/test/fake.ts', 'const t = initTRPC.create()\nexport default t\n')

    const { exitCode, output } = await run(CHECK_MOCK_LOCK)

    expect(output).toContain('defines a tRPC router')
    expect(exitCode).toBe(1)
  })

  test('rejects HTTP-level mocking libraries', async () => {
    await writeFile(
      'apps/web/test/wire.ts',
      "import { setupServer } from 'msw/node'\nexport const server = setupServer()\n",
    )

    const { exitCode, output } = await run(CHECK_MOCK_LOCK)

    expect(output).toContain("imports 'msw/node'")
    expect(output).toContain('installs an HTTP request handler')
    expect(exitCode).toBe(1)
  })

  test('still reads a web source file under a directory named like build output', async () => {
    await writeFile(
      'apps/web/src/dist-mocked/fake.ts',
      'const t = initTRPC.create()\nexport default t\n',
    )

    const { exitCode, output } = await run(CHECK_MOCK_LOCK)

    expect(output).toContain('defines a tRPC router')
    expect(exitCode).toBe(1)
  })

  test('rejects intercepting requests from a playwright step', async () => {
    await writeFile(
      'apps/web/features/steps/bad.steps.ts',
      "await page.route('**/trpc/**', (route) => route.fulfill({ body: '{}' }))\n",
    )

    const { exitCode, output } = await run(CHECK_MOCK_LOCK)

    expect(output).toContain('intercepts network requests')
    expect(output).toContain('fulfils an intercepted request')
    expect(exitCode).toBe(1)
  })

  test('ignores build output, which is not source', async () => {
    // `dist-mocked/` is the SPA built with the typed mock linked in — every
    // dependency's `new Response(` bundled into one line. Reading it would report
    // the bundler for rules about our code, and the scan would fail on a machine
    // that had run the web suite and pass on one that had not.
    await writeFile('apps/web/test/trpc-mock.ts', 'export const mock = {}\n')
    await writeFile('apps/web/dist-mocked/assets/index-abc123.js', 'new Response("{}")\n')
    await writeFile('apps/web/dist/assets/index-def456.js', 'new Response("{}")\n')

    const { exitCode, output } = await run(CHECK_MOCK_LOCK)

    expect(output).toContain('mock-lock: OK')
    expect(exitCode).toBe(0)
  })
})

describe('biome configuration', () => {
  test('never processes anything under .claude/', async () => {
    // `.claude/settings.local.json` is machine-local Claude Code state: it exists
    // in some checkouts and not others, and its formatting is not ours to own.
    // The gate must not depend on which machine it runs on.
    await writeFile('.claude/settings.local.json', UNFORMATTED_JSON)
    await writeFile('.claude/worktrees/other/package.json', UNFORMATTED_JSON)
    await writeFile('packages/core/src/version.ts', "export const CORE_VERSION = '0.0.0'\n")

    const { exitCode, output } = await runBiome()

    expect(output).not.toContain('.claude')
    expect(exitCode).toBe(0)
  })

  test('still processes the product tree', async () => {
    await writeFile('packages/core/src/version.ts', "export  const  CORE_VERSION='0.0.0'\n")

    const { exitCode, output } = await runBiome()

    expect(output).toContain('packages/core/src/version.ts')
    expect(exitCode).toBe(1)
  })

  test('still processes docs json', async () => {
    await writeFile('docs/export/export.v1.schema.json', UNFORMATTED_JSON)

    const { exitCode, output } = await runBiome()

    expect(output).toContain('docs/export/export.v1.schema.json')
    expect(exitCode).toBe(1)
  })

  test('still processes a checkout that itself lives under .claude/worktrees', async () => {
    // Agent worktrees live at .claude/worktrees/<name>, so `.claude` is an
    // ancestor of the whole checkout. An unanchored `!**/.claude` matches that
    // ancestor and biome silently checks nothing — a gate that passes because it
    // looked at zero files. The exclusion has to stay anchored to the root.
    const worktree = join(root, '.claude', 'worktrees', 'granite')
    await Bun.write(join(worktree, 'packages/core/src/version.ts'), "export  const  X='0'\n")

    const { exitCode, output } = await runBiome(worktree)

    expect(output).not.toContain('provided but ignored')
    expect(output).toContain('packages/core/src/version.ts')
    expect(exitCode).toBe(1)
  })
})

/**
 * Retro 3 `r-lint-never-silent`.
 *
 * `biome ci` exits **0** on a warning and on an info, so the gate's lint step
 * printed two warnings and one info on every run for as long as anyone could
 * remember and passed anyway. Noise that is always there is noise nobody reads,
 * and the next real finding would have landed in the middle of it.
 *
 * Exit code is therefore not the whole check: what the repo owes is a lint run
 * with **nothing to say**, and that is an assertion rather than a habit.
 */
describe('the lint has nothing to say', () => {
  /** Biome's one-line success summary, the only thing a clean run may print. */
  const SUMMARY = /^Checked \d+ files in [^\n]*$/

  test('biome ci reports no error, no warning and no info on this repo', async () => {
    const { exitCode, output } = await spawn([BIOME, 'ci', '.'], REPO_ROOT)

    // The whole output minus the summary line, so a warning is as loud a failure
    // here as an error is — the message names what biome actually said.
    const said = stripStyling(output)
      .split('\n')
      .filter((line) => line.trim() !== '' && !SUMMARY.test(line.trim()))

    expect(said, 'biome ci printed diagnostics; the gate passes anyway').toEqual([])
    expect(exitCode).toBe(0)
  })
})
