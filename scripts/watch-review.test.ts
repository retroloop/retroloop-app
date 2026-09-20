import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The finish watch (`r-monitor-notify-gap`, `r-fourth-finish-channel-failure`).
 *
 * The channel has failed four times and every fix was scoped to the hop that had
 * just broken, so what is asserted here is the SHAPE — the property each of those
 * failures violated — rather than the wiring:
 *
 * - **exactly one wait, and no loop.** The monitor it replaced looped forever
 *   printing lines into a file no agent ever read. A stub CLI counts its own
 *   invocations, so "one" is a number here and not a claim about a `while`.
 * - **the exit IS the notification.** The exit code passes through untouched and
 *   the event lands on stdout, because the caller reads the process's exit, not a
 *   line it printed.
 * - **the re-arm instruction is in the output BEFORE the wait blocks.** By the
 *   time an exit or a kill arrives this script is gone; guidance printed after
 *   the fact would be guidance nobody has.
 *
 * `certify` is the end-to-end half and runs against a real throwaway stage
 * (`certify runs the chain` below) — the whole point being that a bridge is
 * proven before it is trusted.
 */

const WATCH = join(import.meta.dir, 'watch-review.sh')

let sandbox = ''

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'retro-watch-'))
})

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true })
})

async function spawn(
  args: string[],
  env: Record<string, string> = {},
  cwd: string = import.meta.dir,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([WATCH, ...args], {
    cwd,
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { exitCode, stdout, stderr }
}

/**
 * A stand-in CLI that records every invocation and answers however the test
 * needs. It is what turns "no loop" into a count instead of a reading of the
 * source.
 */
async function stubCli(body: string): Promise<string> {
  const path = join(sandbox, 'stub-cli.sh')
  await Bun.write(
    path,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${join(sandbox, 'calls.log')}"\n${body}\n`,
  )
  await chmod(path, 0o755)
  return `bash ${path}`
}

async function calls(): Promise<string[]> {
  const file = Bun.file(join(sandbox, 'calls.log'))
  if (!(await file.exists())) return []
  return (await file.text()).trimEnd().split('\n')
}

describe('the watch arms exactly one wait', () => {
  test('the CLI runs once and the script is gone — there is no loop to run twice', async () => {
    // The shape it replaced: a monitor that loops is a monitor whose events can
    // only reach the agent as printed lines, which this harness does not deliver.
    const cli = await stubCli('exit 7')

    const { exitCode } = await spawn(['34'], { WATCH_REVIEW_CLI: cli })

    expect(exitCode).toBe(7)
    expect(await calls()).toHaveLength(1)
  })

  test('it arms the subscribing wait, by retro id, with a timeout', async () => {
    const cli = await stubCli('exit 7')

    await spawn(['34'], { WATCH_REVIEW_CLI: cli })

    expect((await calls())[0]).toBe('review wait --follow --retro 34 --timeout 600 --json')
  })

  test('--timeout replaces the default, and nothing else moves', async () => {
    const cli = await stubCli('exit 7')

    await spawn(['34', '--timeout', '120'], { WATCH_REVIEW_CLI: cli })

    expect((await calls())[0]).toBe('review wait --follow --retro 34 --timeout 120 --json')
  })

  test('the event comes back on stdout and the exit code is the CLI’s own', async () => {
    const event = '{"kind":"ReviewFinished","retroId":34,"revision":1}'
    const cli = await stubCli(`printf '%s\\n' '${event}'\nexit 0`)

    const { exitCode, stdout } = await spawn(['34'], { WATCH_REVIEW_CLI: cli })

    expect(exitCode).toBe(0)
    expect(stdout.trim()).toBe(event)
  })

  test('the guidance is on stderr, so a caller can parse stdout as JSON', async () => {
    const event = '{"kind":"ReviewFinished","retroId":34,"revision":1}'
    const cli = await stubCli(`printf '%s\\n' '${event}'\nexit 0`)

    const { stdout, stderr } = await spawn(['34'], { WATCH_REVIEW_CLI: cli })

    expect(JSON.parse(stdout)).toMatchObject({ kind: 'ReviewFinished' })
    expect(stderr).toContain('armed on retro 34')
  })
})

describe('the re-arm instruction is in the output before the wait blocks', () => {
  /**
   * The fourth failure was not a missing command, it was a reading: two outside
   * kills were read as a stop gesture and the watch was stood down mid-review.
   * The kill notification carries whatever this printed at arming time and
   * nothing else, so the instruction has to already be there.
   */
  test('arming says what each exit means and what to do about a kill', async () => {
    const cli = await stubCli('exit 7')

    const { stderr } = await spawn(['34'], { WATCH_REVIEW_CLI: cli })

    expect(stderr).toContain('RE-ARM ON KILL')
    expect(stderr).toContain('never stood down')
    expect(stderr).toContain('relaunch:  scripts/watch-review.sh 34 --timeout 600')
  })

  test('exit 7 is named as the timeout and not as a decline', async () => {
    const cli = await stubCli('exit 7')

    const { stderr } = await spawn(['34'], { WATCH_REVIEW_CLI: cli })

    expect(stderr).toContain('exit 7 = the timeout elapsed and NOTHING else')
    expect(stderr).toContain('do not read it as a decline')
  })

  test('the hop map travels with the arming, so the chain is readable at the exit', async () => {
    const cli = await stubCli('exit 7')

    const { stderr } = await spawn(['34'], { WATCH_REVIEW_CLI: cli })

    expect(stderr).toContain('press → store → wait → watcher(this) → agent')
  })
})

describe('the watch refuses what it cannot arm', () => {
  test('no arguments prints the usage rather than guessing a retro', async () => {
    const { exitCode, stderr } = await spawn([])

    expect(exitCode).toBe(2)
    expect(stderr).toContain('arm one wait')
  })

  test('a retro id that is not a number is refused, and the message says which number', async () => {
    const cli = await stubCli('exit 7')

    const { exitCode, stderr } = await spawn(['session-3'], { WATCH_REVIEW_CLI: cli })

    expect(exitCode).toBe(2)
    expect(stderr).toContain('is not a retro id')
    expect(await calls()).toHaveLength(0)
  })

  test('a non-numeric timeout is refused before anything is armed', async () => {
    const cli = await stubCli('exit 7')

    const { exitCode, stderr } = await spawn(['34', '--timeout', 'a while'], {
      WATCH_REVIEW_CLI: cli,
    })

    expect(exitCode).toBe(2)
    expect(stderr).toContain('whole seconds')
    expect(await calls()).toHaveLength(0)
  })

  test('with no CLI anywhere it says so instead of arming nothing', async () => {
    // From outside any checkout there is no repo CLI to fall back to, and `retro`
    // is not installed on this machine — the one arrangement in which the refusal
    // is reachable, and the arrangement a caller outside the repo is actually in.
    const { exitCode, stderr } = await spawn(['34'], { WATCH_REVIEW_CLI: '' }, sandbox)

    expect(exitCode).toBe(2)
    expect(stderr).toContain('no retroloop CLI')
  })

  test('an override that resolves to no command is refused, not armed quietly', async () => {
    // `"${CLI[@]}"` on an empty array runs nothing and says nothing, which is the
    // exact silence this script exists to remove.
    const { exitCode, stderr } = await spawn(['34'], { WATCH_REVIEW_CLI: '   ' }, sandbox)

    expect(exitCode).toBe(2)
    expect(stderr).toContain('no retroloop CLI')
  })
})

describe('where says what it would run', () => {
  test('it names the CLI and the stage tool it resolved', async () => {
    const { exitCode, stdout } = await spawn(['where'])

    expect(exitCode).toBe(0)
    expect(stdout).toContain('apps/cli/src/bin.ts')
    expect(stdout).toContain('e2e/support/stage-tool.ts')
  })

  test('an override is what it reports, so the transcript names what actually ran', async () => {
    const { stdout } = await spawn(['where'], { WATCH_REVIEW_CLI: 'some other retro' })

    expect(stdout).toContain('cli:         some other retro')
  })
})

/**
 * The end-to-end half, against a real throwaway stage — the whole point of the
 * record behind it: *nothing certifies the chain end to end before it is
 * trusted*. This runs the real CLI, the real store and the real stage-tool
 * press, and it is where the killed-watcher drill lives.
 */
describe('certify runs the chain against a throwaway stage', () => {
  test('all three legs hold, and the verdict names what it could not certify', async () => {
    const { exitCode, stderr } = await spawn(['certify'])

    expect(stderr).toContain('the red leg')
    expect(stderr).toContain('the whole chain, once')
    expect(stderr).toContain('the killed-watcher drill')
    expect(stderr).toContain('CERTIFIED')
    expect(stderr).not.toContain('FAIL')
    // The hop no script can assert is named with its probe rather than skipped.
    expect(stderr).toContain('watcher → AGENT')
    expect(stderr).toContain('EXIT notification actually arrives')
    expect(exitCode).toBe(0)
  }, 180_000)

  test('the drill proves the gap costs nothing, not merely that a re-arm runs', async () => {
    const { stderr } = await spawn(['certify'])

    expect(stderr).toContain('having delivered nothing — the window is real')
    expect(stderr).toContain('pressed with NOTHING armed')
    expect(stderr).toContain('delivered the press it was not there for')
  }, 180_000)

  test('certify without a stage tool refuses, because finishing has no CLI surface', async () => {
    // The press is the human's and has no CLI command by design, so certify
    // borrows the e2e stage tool. Without one it refuses rather than certifying
    // a chain whose press it never made.
    const { exitCode, stderr } = await spawn(['certify'], { WATCH_REVIEW_STAGE_TOOL: '  ' })

    expect(exitCode).toBe(2)
    expect(stderr).toContain('no stage tool')
  }, 60_000)
})
