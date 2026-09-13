import { afterAll, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '@retro/cli'
import { DATABASE_FILENAME } from '@retro/core'

/**
 * The dev-only seed, both halves of it: the refusal, and the stage it leaves
 * behind.
 *
 * **The refusal is the half worth a test.** The script writes a retrospective as
 * the *human* — it records the verdicts and finishes the review, which no CLI
 * command can do — so an accidental run against a real stage would put human data
 * into it that nobody decided. The env var is what stands between those two, and
 * a guard nobody has watched refuse is a guard nobody can trust. The directory
 * check beside the exit code is the point: refusing is only a refusal if nothing
 * was written on the way to it.
 *
 * The seeded half is read back **through the CLI**, in this process, over the
 * real SQLite file the script just wrote — not through the core API the script
 * used. A read that went back the way the write came would prove the script
 * agrees with itself; what an acceptance run actually needs is that
 * `record queue` hands out the records, which is one lane command, one store and
 * two processes away from anything this file arranged.
 */

const SCRIPT = join(import.meta.dir, 'dev-seed-finished-retro.ts')
const FOOTPRINT = 'apps/cli/src/commands/record.ts'

const homes: string[] = []

afterAll(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

function newHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'retro-dev-seed-'))
  homes.push(home)
  return home
}

async function seed(
  args: readonly string[],
  env: Record<string, string>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(['bun', 'run', SCRIPT, ...args], {
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

/** The CLI in this process against the stage the script wrote — the real store. */
async function cli(home: string, argv: readonly string[]): Promise<unknown> {
  const out: string[] = []
  const err: string[] = []
  const code = await run(argv, {
    env: { RETROLOOP_HOME: home },
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  })
  expect(code, `\`${argv.join(' ')}\` failed: ${err.join('\n')}`).toBe(0)
  return JSON.parse(out.join('\n')) as unknown
}

type SeedOutput = { retroId: number; sessionId: number; recordIds: number[] }

type QueueRow = {
  recordId: number
  involvement: string
  selectedSolution: { footprint: string[] }
  claim: null | { claimedAt: string; actor: string }
}

type FinishedReview = {
  retroId: number
  closed: boolean
  counts: { approved: number }
}

test('refuses without RETROLOOP_DEV_SEED, and writes nothing on the way out', async () => {
  const home = newHome()

  const { exitCode, stdout, stderr } = await seed(['--records', '2', '--home', home], {
    // Explicitly empty rather than merely absent: a machine that exports the
    // variable for its own reasons must not turn this refusal into a seed.
    RETROLOOP_DEV_SEED: '',
  })

  expect(exitCode).toBe(2)
  expect(stdout).toBe('')
  expect(JSON.parse(stderr.trim())).toEqual({
    error: { code: 'DEV_SEED_DISABLED', message: expect.stringContaining('RETROLOOP_DEV_SEED=1') },
  })
  // Nothing was opened, so nothing was migrated: `openSqliteStore` creates the
  // stage directory and the file on the way in, and a refusal that had reached
  // it would leave both behind.
  expect(existsSync(join(home, 'data', DATABASE_FILENAME))).toBe(false)
})

test('refuses a record count that is not one, before it opens anything', async () => {
  const home = newHome()

  for (const records of ['0', '-1', '2.5', 'many', '51']) {
    const { exitCode, stdout } = await seed(['--records', records, '--home', home], {
      RETROLOOP_DEV_SEED: '1',
    })

    expect(exitCode, `--records ${records} was accepted`).toBe(2)
    expect(stdout).toBe('')
  }

  expect(existsSync(join(home, 'data', DATABASE_FILENAME))).toBe(false)
})

test('leaves a finished review whose records are on the queue', async () => {
  const home = newHome()

  const { exitCode, stdout, stderr } = await seed(
    ['--records', '3', '--footprint', FOOTPRINT, '--home', home],
    { RETROLOOP_DEV_SEED: '1' },
  )

  expect(stderr).toBe('')
  expect(exitCode).toBe(0)

  const seeded = JSON.parse(stdout.trim()) as SeedOutput
  expect(Object.keys(seeded).sort()).toEqual(['recordIds', 'retroId', 'sessionId'])
  expect(seeded.recordIds).toHaveLength(3)
  // Minted in `num` order and dense, which is what makes `recordIds[0]` the
  // record a caller is about to claim rather than whichever one came back first.
  expect(seeded.recordIds).toEqual([1, 2, 3])

  /**
   * The round is **finished and not closed**, which is the state this script
   * exists to reach: the queue is made of finished rounds, and closing one is
   * the lane's own act rather than something a fixture should have done for it.
   */
  const reviews = (await cli(home, ['review', 'list', '--finished', '--json'])) as FinishedReview[]
  expect(reviews).toHaveLength(1)
  expect(reviews[0]).toMatchObject({
    retroId: seeded.retroId,
    closed: false,
    counts: { approved: 3 },
  })

  const queue = (await cli(home, ['record', 'queue', '--json'])) as QueueRow[]
  expect(queue.map((row) => row.recordId)).toEqual(seeded.recordIds)
  for (const row of queue) {
    // The three things an agent reads before it starts: how much of the human
    // the fix needs, which files it touches, and whether anybody is already on
    // it. A seed that left any of them unset would hand out work nobody can act
    // on without opening the review page.
    expect(row.involvement).toBe('autonomous')
    expect(row.selectedSolution.footprint).toEqual([FOOTPRINT])
    expect(row.claim).toBeNull()
  }
})

test('takes the involvement it is given, so a run can seed work that needs the human', async () => {
  const home = newHome()

  const { exitCode, stdout } = await seed(
    ['--records', '1', '--involvement', 'interactive', '--home', home],
    { RETROLOOP_DEV_SEED: '1' },
  )
  expect(exitCode).toBe(0)

  const seeded = JSON.parse(stdout.trim()) as SeedOutput
  expect(seeded.recordIds).toHaveLength(1)

  const queue = (await cli(home, ['record', 'queue', '--json'])) as QueueRow[]
  expect(queue).toHaveLength(1)
  expect(queue[0]?.involvement).toBe('interactive')
  // The default footprint is the literal `none`, which the lane reads as "no
  // files" rather than as a file called none (`lane.view.ts` §laneFootprint) —
  // so a seed nobody pointed at a path hands out work that names none.
  expect(queue[0]?.selectedSolution.footprint).toEqual([])
})
