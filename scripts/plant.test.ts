import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The plant harness (`r-plant-revert-second`, `r-ineffective-plant-blind` and
 * `r-control-test-signature`).
 *
 * A guard written because prose failed twice has to be shown failing, so every
 * refusal below is exercised against a real git worktree — and the tests that
 * matter most are reproductions of the incidents themselves: uncommitted work in
 * the target at plant time and uncommitted work written into the target after it
 * (neither may be reachable by the revert); a plant the check cannot see, which
 * shipped as a finding; and a reproduce-on-another-tree control, which was read
 * as sabotage because nothing declared it.
 */

const PLANT = join(import.meta.dir, 'plant.sh')

/** The file every fixture plants into, and the "real work" it is written beside. */
const SOURCE = 'src/app.ts'
const COMMITTED = 'export function greet(name: string) {\n  return name.trim()\n}\n'
const FIX = 'export function farewell(name: string) {\n  return name.toUpperCase()\n}\n'

let repo = ''

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'retro-plant-'))
  await git('init', '-q', '-b', 'main')
  await git('config', 'user.email', 'fixture@example.com')
  await git('config', 'user.name', 'Fixture')
  await write(SOURCE, COMMITTED)
  await git('add', '-A')
  await git('commit', '-qm', 'the real work, committed')
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

async function spawn(
  command: string[],
  cwd: string = repo,
): Promise<{ exitCode: number; output: string }> {
  const proc = Bun.spawn(command, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { exitCode, output: `${stdout}${stderr}` }
}

function git(...args: string[]): Promise<{ exitCode: number; output: string }> {
  return spawn(['git', ...args])
}

function write(relativePath: string, contents: string): Promise<number> {
  return Bun.write(join(repo, relativePath), contents)
}

function read(relativePath: string): Promise<string> {
  return Bun.file(join(repo, relativePath)).text()
}

/**
 * The check that certifies every fixture plant: green on a clean tree, red the
 * moment the plant lands. `BROKEN` is the second way to redden it, for the case
 * where the tree is failing for a reason the revert cannot undo.
 */
const CHECK = `! grep -q 'const PLANTED' ${SOURCE} && ! test -f BROKEN`

/** Plants by running `apply` as the harness's own subcommand, the only way in. */
function plant(
  targets: string[],
  apply: string,
  options: { check?: string; expectGreen?: boolean } = {},
): Promise<{ exitCode: number; output: string }> {
  const flags = ['--check', options.check ?? CHECK]
  if (options.expectGreen) flags.push('--expect-green')
  return spawn([PLANT, ...flags, ...targets, '--', 'bash', '-c', apply])
}

function revert(): Promise<{ exitCode: number; output: string }> {
  return spawn([PLANT, '--revert'])
}

/** Runs `command` against another tree's content, under a declared intent. */
function control(
  declaration: string,
  targets: string[],
  command: string,
  options: { from?: string } = {},
): Promise<{ exitCode: number; output: string }> {
  const flags = ['--why', declaration]
  if (options.from) flags.push('--from', options.from)
  return spawn([PLANT, 'control', ...flags, ...targets, '--', 'bash', '-c', command])
}

function log(): Promise<{ exitCode: number; output: string }> {
  return spawn([PLANT, '--log'])
}

/** Appends a line the file did not have — a defect the check catches. */
const PLANT_LINE = `printf '%s\\n' 'const PLANTED = true' >> ${SOURCE}`

/** A real diff the check cannot see: the dead plant, in one line. */
const INERT_LINE = `printf '%s\\n' '// a comment no check ever reads' >> ${SOURCE}`

describe('the plant harness refuses the unsafe order', () => {
  test('a fix sitting uncommitted in the target is never planted over', async () => {
    // Both losses were the same shape: real work uncommitted in the file the
    // plant was about to touch. The revert is what erased it, and this is the
    // step that makes the revert unreachable.
    await write(SOURCE, `${COMMITTED}${FIX}`)

    const { exitCode, output } = await plant([SOURCE], PLANT_LINE)

    expect(output).toContain('uncommitted work')
    expect(output).toContain('commit the real work first')
    expect(exitCode).toBe(1)
    expect(await read(SOURCE)).toBe(`${COMMITTED}${FIX}`)
  })

  test('the refusal names the file that is dirty', async () => {
    // `toContain(SOURCE)` alone passes on a plant that went ahead and announced
    // the target it planted in — the refusal has to be the sentence carrying it.
    await write(SOURCE, `${COMMITTED}${FIX}`)

    const { output } = await plant([SOURCE], PLANT_LINE)

    expect(output).toContain(`refusing — the plant targets carry uncommitted work:\n M ${SOURCE}`)
  })

  test('a plant is refused while another is active', async () => {
    expect((await plant([SOURCE], PLANT_LINE)).exitCode).toBe(0)

    const { exitCode, output } = await plant([SOURCE], PLANT_LINE)

    expect(output).toContain('a plant is already active')
    expect(output).toContain('--revert')
    expect(exitCode).toBe(1)
  })

  test('an untracked file cannot be planted in, having nothing to restore to', async () => {
    await write('src/scratch.ts', 'export const scratch = 1\n')

    const { exitCode, output } = await plant(['src/scratch.ts'], PLANT_LINE)

    expect(output).toContain('not tracked by git')
    expect(exitCode).toBe(1)
  })

  test('a plant that changed nothing is refused rather than reported', async () => {
    // A plant nothing can catch is the failed-to-fail case wearing a green tick.
    const { exitCode, output } = await plant([SOURCE], 'true')

    expect(output).toContain('changed nothing')
    expect(exitCode).toBe(1)
    expect(await read(SOURCE)).toBe(COMMITTED)
  })

  test('an apply command that strays outside its targets is refused and rolled back', async () => {
    await write('src/other.ts', 'export const other = 1\n')
    await git('add', '-A')
    await git('commit', '-qm', 'a second file')

    const { exitCode, output } = await plant(
      [SOURCE],
      `${PLANT_LINE} && printf '%s\\n' 'stray' >> src/other.ts`,
    )

    expect(output).toContain('changed files it did not name')
    expect(output).toContain('src/other.ts')
    expect(exitCode).toBe(1)
    expect(await read(SOURCE)).toBe(COMMITTED)
  })
})

describe('the plant harness restores exactly its own diff', () => {
  test('work written after the plant survives the revert', async () => {
    // The proof that the historical failure cannot happen even when the worker
    // does keep planting mid-flow: the fix arrives *after* the plant, is never
    // committed, and the revert still only unwinds what it planted.
    await plant([SOURCE], PLANT_LINE)
    await write(SOURCE, `${COMMITTED}${FIX}const PLANTED = true\n`)

    const { exitCode, output } = await revert()

    expect(output).toContain('reverted the plant')
    expect(exitCode).toBe(0)
    expect(await read(SOURCE)).toBe(`${COMMITTED}${FIX}`)
  })

  test('a clean plant and revert leaves the file exactly as it was committed', async () => {
    await plant([SOURCE], PLANT_LINE)
    expect(await read(SOURCE)).toContain('const PLANTED = true')

    await revert()

    expect(await read(SOURCE)).toBe(COMMITTED)
    expect((await git('status', '--porcelain')).output).toBe('')
  })

  test('uncommitted work elsewhere in the tree is not the revert’s business', async () => {
    // The revert that erased work was `git checkout -- .`, which is why
    // "elsewhere" needs its own assertion rather than being assumed from the one
    // above.
    await write('src/other.ts', 'export const other = 1\n')
    await git('add', '-A')
    await git('commit', '-qm', 'a second file')
    await plant([SOURCE], PLANT_LINE)
    await write('src/other.ts', 'export const other = 2\n')
    await write('src/untracked.ts', 'export const fresh = 1\n')

    await revert()

    expect(await read('src/other.ts')).toBe('export const other = 2\n')
    expect(await read('src/untracked.ts')).toBe('export const fresh = 1\n')
  })

  test('a plant whose own lines moved under it fails loudly and changes nothing', async () => {
    await plant([SOURCE], PLANT_LINE)
    const rewritten = `${COMMITTED}const PLANTED = 'edited'\n`
    await write(SOURCE, rewritten)

    const { exitCode, output } = await revert()

    expect(output).toContain('could not unwind the plant')
    expect(output).toContain('nothing was changed')
    expect(exitCode).toBe(1)
    expect(await read(SOURCE)).toBe(rewritten)
  })

  test('reverting with no plant active says so instead of touching the tree', async () => {
    await write(SOURCE, `${COMMITTED}${FIX}`)

    const { exitCode, output } = await revert()

    expect(output).toContain('nothing to revert')
    expect(exitCode).toBe(1)
    expect(await read(SOURCE)).toBe(`${COMMITTED}${FIX}`)
  })

  test('two targets are planted and reverted together', async () => {
    await write('src/other.ts', 'export const other = 1\n')
    await git('add', '-A')
    await git('commit', '-qm', 'a second file')

    const planted = await plant(
      [SOURCE, 'src/other.ts'],
      `${PLANT_LINE} && printf '%s\\n' 'const PLANTED = true' >> src/other.ts`,
    )

    expect(planted.exitCode).toBe(0)
    expect(await read('src/other.ts')).toContain('const PLANTED = true')

    await revert()

    expect(await read(SOURCE)).toBe(COMMITTED)
    expect(await read('src/other.ts')).toBe('export const other = 1\n')
  })
})

describe('a plant is certified by its check, or it is not a plant', () => {
  test('a plant with no check command is refused before a target is touched', async () => {
    // The check is what a plant is *for*; without one there is nothing to
    // certify and the old interface would have planted anyway.
    const { exitCode, output } = await spawn([PLANT, SOURCE, '--', 'bash', '-c', PLANT_LINE])

    expect(output).toContain('usage:')
    expect(exitCode).toBe(2)
    expect(await read(SOURCE)).toBe(COMMITTED)
  })

  test('a check that is already red has no green baseline to plant against', async () => {
    const { exitCode, output } = await plant([SOURCE], PLANT_LINE, { check: 'false' })

    expect(output).toContain('the check is red before the plant')
    expect(exitCode).toBe(1)
    expect(await read(SOURCE)).toBe(COMMITTED)
    expect((await git('status', '--porcelain')).output).toBe('')
  })

  test('a plant the check cannot see is refused and rolled back', async () => {
    // The dead plant that shipped as a finding: it edited a tally but not the
    // useMemo deps that recomputed it, so the
    // diff was non-empty, the suite stayed green at 214/214, and the report would
    // have read "the scenario failed to catch it". A non-empty diff is not evidence.
    const { exitCode, output } = await plant([SOURCE], INERT_LINE)

    expect(output).toContain('the check stayed green with the plant applied')
    expect(output).toContain('--expect-green')
    expect(exitCode).toBe(1)
    expect(await read(SOURCE)).toBe(COMMITTED)
    expect((await git('status', '--porcelain')).output).toBe('')
  })

  test('--expect-green lets an absence assertion through, and the log says so', async () => {
    const planted = await plant([SOURCE], INERT_LINE, { expectGreen: true })

    expect(planted.exitCode).toBe(0)
    expect((await log()).output).toContain('planted   green (acknowledged: --expect-green)')
  })

  test('the log carries all three results, so a plant table is copied not recalled', async () => {
    await plant([SOURCE], PLANT_LINE)
    await revert()

    const { output } = await log()

    expect(output).toContain('baseline  green')
    expect(output).toContain('planted   red')
    expect(output).toContain('reverted  green')
    expect(output).toContain('CERTIFIED')
    expect(output).toContain(CHECK)
  })

  test('an empty argument survives into the log instead of vanishing', async () => {
    // `sed -i '' <script>` is the real shape of an apply command on macOS, and
    // joining the argv on spaces drops the empty argument: the logged line then
    // reads like the command that ran while being one that would not run.
    const planted = await spawn([
      PLANT,
      '--check',
      CHECK,
      SOURCE,
      '--',
      'bash',
      '-c',
      `printf '%s\\n' "$1" >> ${SOURCE}`,
      '',
      'const PLANTED = true',
    ])

    expect(planted.exitCode).toBe(0)
    expect((await log()).output).toContain(`'' 'const PLANTED = true'`)
  })

  test('a revert whose check comes back red is not a certified cycle', async () => {
    await plant([SOURCE], PLANT_LINE)
    await write('BROKEN', 'the tree is red for a reason the revert cannot undo\n')

    const { exitCode, output } = await revert()

    expect(output).toContain('NOT a certified cycle')
    expect(exitCode).toBe(1)
    expect(await read(SOURCE)).toBe(COMMITTED) // the revert itself still happened
  })
})

describe('a control declares its intent, so no observer has to guess', () => {
  /** The branch's own committed work, which every control has to give back. */
  const BRANCH = `${COMMITTED}export const feature = true\n`
  const WHY = 'reproducing the landing flake on unmodified main'

  beforeEach(async () => {
    await git('checkout', '-q', '-b', 'feature')
    await write(SOURCE, BRANCH)
    await git('commit', '-qam', 'the branch’s own work')
  })

  test('the command sees the other tree’s content and the branch gets its own back', async () => {
    const { exitCode, output } = await control(WHY, [SOURCE], 'cp src/app.ts seen.txt')

    expect(exitCode).toBe(0)
    expect(await read('seen.txt')).toBe(COMMITTED)
    expect(await read(SOURCE)).toBe(BRANCH)
    expect(output).toContain('restored')
  })

  test('a control leaves neither a staged nor an unstaged change behind', async () => {
    // The record itself: `git checkout main -- <paths>` *stages* a wholesale
    // revert, which is the signature that cost an emergency interrupt. This mode
    // never stages anything, so it cannot even produce that signature.
    await control(WHY, [SOURCE], 'true')

    expect((await git('diff', '--cached', '--name-only')).output).toBe('')
    expect((await git('diff', '--name-only')).output).toBe('')
  })

  test('the declaration is readable from the worktree while the control is live', async () => {
    // An observer holding only the worktree runs `plant.sh --log` and reads the
    // intent, instead of reading a git signature and calling an emergency. The
    // control's own command stands in for that observer.
    await control(WHY, [SOURCE], `${PLANT} --log > seen.txt`)

    const seen = await read('seen.txt')
    expect(seen).toContain('control')
    expect(seen).toContain(WHY)
  })

  test('the log quotes the command it records, so it pastes back into a shell', async () => {
    await control(WHY, [SOURCE], 'cp src/app.ts seen.txt')

    expect((await log()).output).toContain(`command   bash -c 'cp src/app.ts seen.txt'`)
  })

  test('the branch is restored even when the control command fails', async () => {
    const { exitCode } = await control(WHY, [SOURCE], 'exit 3')

    expect(exitCode).toBe(3)
    expect(await read(SOURCE)).toBe(BRANCH)
    expect((await git('status', '--porcelain')).output).toBe('')
  })

  test('a control refuses to start on a dirty target, same standard as a plant', async () => {
    await write(SOURCE, `${BRANCH}${FIX}`)

    const { exitCode, output } = await control(WHY, [SOURCE], 'true')

    expect(output).toContain('uncommitted work')
    expect(exitCode).toBe(1)
    expect(await read(SOURCE)).toBe(`${BRANCH}${FIX}`)
  })

  test('a control with no declaration is not a control', async () => {
    const { exitCode, output } = await spawn([PLANT, 'control', SOURCE, '--', 'bash', '-c', 'true'])

    expect(output).toContain('usage:')
    expect(exitCode).toBe(2)
    expect(await read(SOURCE)).toBe(BRANCH)
  })

  test('a control is refused while a plant is active, and the plant is untouched', async () => {
    await plant([SOURCE], PLANT_LINE)

    const { exitCode, output } = await control(WHY, [SOURCE], 'true')

    expect(output).toContain('already active')
    expect(exitCode).toBe(1)
    expect(await read(SOURCE)).toContain('const PLANTED = true')
  })

  test('--from borrows from the named rev, not only from main', async () => {
    const other = `${COMMITTED}export const other = 1\n`
    await git('checkout', '-q', '-b', 'other')
    await write(SOURCE, other)
    await git('commit', '-qam', 'a third tree')
    await git('checkout', '-q', 'feature')

    const { exitCode } = await control(WHY, [SOURCE], 'cp src/app.ts seen.txt', { from: 'other' })

    expect(exitCode).toBe(0)
    expect(await read('seen.txt')).toBe(other)
    expect(await read(SOURCE)).toBe(BRANCH)
  })

  test('a rev that never had the file is refused before anything is moved', async () => {
    await write('src/feature-only.ts', 'export const featureOnly = 1\n')
    await git('add', '-A')
    await git('commit', '-qm', 'a file main never had')

    const { exitCode, output } = await control(WHY, ['src/feature-only.ts'], 'true')

    expect(output).toContain('does not exist in main')
    expect(exitCode).toBe(1)
    expect(await read('src/feature-only.ts')).toBe('export const featureOnly = 1\n')
  })
})

describe('the harness keeps its own state out of the tree', () => {
  test('a live plant leaves the working tree showing only the plant', async () => {
    await plant([SOURCE], PLANT_LINE)

    const { output } = await git('status', '--porcelain')

    expect(output.trim()).toBe(`M ${SOURCE}`)
  })

  test('the state is dropped once the plant is reverted', async () => {
    await plant([SOURCE], PLANT_LINE)
    await revert()

    expect(await Bun.file(join(repo, '.git/retro-plant/plant.patch')).exists()).toBe(false)
  })

  test('the log outlives the state it records, and says so when empty', async () => {
    const empty = await log()
    expect(empty.output).toContain('no plant log yet')

    await plant([SOURCE], PLANT_LINE)
    await revert()

    expect(await Bun.file(join(repo, '.git/retro-plant')).exists()).toBe(false)
    expect((await log()).output).toContain('CERTIFIED')
    expect((await git('status', '--porcelain')).output).toBe('')
  })
})

/**
 * Evidence arrives already formatted, and the trap says so at the moment it arms
 * (`r-invented-evidence-reads-real` and `r-stale-dist-after-control`).
 *
 * Both are keystroke-level rules with prose priors that did not hold: the
 * unverified-claims lineage was in the docs when invented numbers were typed
 * into a comment, and the stale-server rule was written for merges when three
 * branches walked into its mirror image. So both directions are asserted here —
 * the cycle that certifies prints them, and the cycle that certifies nothing
 * does not claim it did.
 */
describe('a certified cycle hands over its own evidence', () => {
  test('the excerpt carries the log path and all three verdicts, ready to paste', async () => {
    await plant([SOURCE], PLANT_LINE)

    const { output } = await revert()

    expect(output).toContain('paste this, do not retype it')
    expect(output).toContain(join(repo, '.git/retro-plant.log'))
    expect(output).toContain('baseline  green')
    expect(output).toContain('planted   red (the check caught the plant)')
    expect(output).toContain('reverted  green — CERTIFIED')
    expect(output).toContain(`targets   ${SOURCE}`)
  })

  test('the excerpt is this run, not the whole log', async () => {
    await plant([SOURCE], PLANT_LINE)
    await revert()
    await plant([SOURCE], INERT_LINE, { expectGreen: true })

    const { output } = await revert()

    // Two cycles are in the log by now; the block printed is the second one.
    expect(output).toContain('planted   green (acknowledged: --expect-green)')
    expect(output).not.toContain('planted   red (the check caught the plant)')
  })

  test('a cycle that certifies nothing prints no certified excerpt', async () => {
    await plant([SOURCE], PLANT_LINE)
    await write('BROKEN', 'the tree is red for a reason the revert cannot undo\n')

    const { output } = await revert()

    expect(output).toContain('NOT a certified cycle')
    expect(output).not.toContain('paste this, do not retype it')
  })

  test('a finished control prints its own block the same way', async () => {
    await git('checkout', '-q', '-b', 'excerpt-branch')
    await write(SOURCE, `${COMMITTED}export const feature = true\n`)
    await git('commit', '-qam', 'the branch’s own work')

    const { output } = await control('reproducing the flake on main', [SOURCE], 'true', {
      from: 'main',
    })

    expect(output).toContain('paste this, do not retype it')
    expect(output).toContain('declared  reproducing the flake on main')
    expect(output).toContain('result    the command exited 0')
  })
})

describe('a restore says the build behind it is now stale', () => {
  test('the revert warns, naming the rebuild and the marker check', async () => {
    await plant([SOURCE], PLANT_LINE)

    const { output } = await revert()

    expect(output).toContain('any standing build is now STALE')
    expect(output).toContain('rebuild before serving')
    expect(output).toContain('marker only your change emits')
  })

  test('the control warns — the path the record was actually filed about', async () => {
    await git('checkout', '-q', '-b', 'stale-branch')
    await write(SOURCE, `${COMMITTED}export const feature = true\n`)
    await git('commit', '-qam', 'the branch’s own work')

    const { output } = await control('serving main’s content', [SOURCE], 'true', { from: 'main' })

    expect(output).toContain('any standing build is now STALE')
  })

  test('a rolled-back plant warns too — it put content back as well', async () => {
    // The inert-plant refusal restores the targets, so the trap it arms is the
    // same one, and nothing about the refusal says otherwise on its own.
    const { output } = await plant([SOURCE], INERT_LINE)

    expect(output).toContain('inert')
    expect(output).toContain('any standing build is now STALE')
  })

  test('a run that restored nothing stays quiet about the build', async () => {
    // A refusal that never touched a target has not invalidated anything, and a
    // warning printed there would be the noise that makes the real one skippable.
    await write(SOURCE, `${COMMITTED}${FIX}`)

    const { output } = await plant([SOURCE], PLANT_LINE)

    expect(output).toContain('uncommitted work')
    expect(output).not.toContain('STALE')
  })
})
