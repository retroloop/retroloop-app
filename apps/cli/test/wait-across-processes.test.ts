import { afterAll, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp, openSqliteStore } from '@retro/core'
import { aRevisionDraft } from './support/harness'

/**
 * **What this file is allowed to take on a loaded machine** (retro 7
 * `r-cli-suite-load-fragile`).
 *
 * Every test here spawns real `bun run` processes against a real SQLite file,
 * so its cost is process startup plus the work — and process startup is the part
 * that stretches when three lanes are building at once. The record asked for an
 * explicit budget sized to that machine rather than an implicit default, and
 * these are the three budgets that decide the outcome:
 *
 * - `BUDGET_MS` is each test's own. The file already carried an explicit 60s
 *   where the record expected a default; it is doubled here, because 60s was
 *   chosen for a machine doing nothing else.
 * - `WAIT_SECONDS` is the waiting CLI's own `--timeout`, and it is deliberately
 *   **inside** `BUDGET_MS`: a genuine hang should be reported by the wait, which
 *   says what it was waiting for, rather than by the runner killing the test.
 * - `CLEANUP_MS` is the one budget here that really was implicit — `afterAll`
 *   removes up to four stage directories and had bun's default.
 *
 * None of this is a fix for a flake that a shorter code path would solve; it is
 * the honest cost of a suite that shells out, stated instead of assumed.
 */
const BUDGET_MS = 120_000
const WAIT_SECONDS = 90
const CLEANUP_MS = 30_000

const stages: string[] = []
afterAll(() => {
  for (const dir of stages.splice(0)) rmSync(dir, { recursive: true, force: true })
}, CLEANUP_MS)

/**
 * A throwaway root laid out the way the product lays one out: `--home` names the
 * root and the stage is `<root>/data`, so what these processes exercise is the
 * real resolution and not a directory handed straight to the store.
 */
function newHome(prefix: string): { home: string; dataDir: string } {
  const home = mkdtempSync(join(tmpdir(), prefix))
  stages.push(home)
  const dataDir = join(home, 'data')
  mkdirSync(dataDir, { recursive: true })
  return { home, dataDir }
}

const BIN = join(import.meta.dir, '../src/bin.ts')
const FINISHER = join(import.meta.dir, 'support/finish-review.ts')

/** A real stage with a review ready to be finished. */
async function seedStage(): Promise<{ home: string; dataDir: string; retroId: number }> {
  const { home, dataDir } = newHome('retro-xproc-')

  const store = openSqliteStore({ dataDir })
  const app = createApp(store)

  const { session } = await app.sessions.create.execute({
    actor: 'ai',
    claudeSession: 'uuid-cross-process',
    project: 'retro',
    cwd: '/tmp',
  })
  const { retroId, revision } = await app.revisions.create.execute({
    actor: 'ai',
    session: session.id,
    revision: JSON.parse(aRevisionDraft()) as unknown,
  })
  // Every record decided, or the finish gate would refuse (D3).
  for (const record of revision.records) {
    await app.decisions.record.execute({
      actor: 'human',
      retro: { retroId },
      rid: record.rid,
      decision: { state: 'approved' },
    })
  }
  await store.close()

  return { home, dataDir, retroId }
}

/**
 * `review wait` unblocks on a write from another process (BACKLOG item 4's
 * done-when; realtime.md §CLI waiting).
 *
 * This is the one thing the in-process suite cannot show. Two real processes, one
 * real SQLite file, no server between them: the waiting CLI learns that the review
 * finished because the database told it, which is the whole premise of the design
 * — the DB is the hub, and capture and waiting survive the server being down.
 *
 * The ordering is not load-bearing. `wait` starts its cursor at the latest
 * `RevisionCreated`, so it returns the outcome whether that outcome lands while it
 * is polling or a moment before it started. The sleep below makes the intended
 * sequence the likely one; it is not what keeps the test from flaking.
 */
test(
  'review wait returns when another process finishes the review',
  async () => {
    const { home, dataDir, retroId } = await seedStage()

    const waiter = Bun.spawn(
      [
        'bun',
        'run',
        BIN,
        'review',
        'wait',
        '--retro',
        String(retroId),
        '--home',
        home,
        '--timeout',
        String(WAIT_SECONDS),
        '--json',
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    )

    // Let the waiter open the stage and poll at least once with nothing to find.
    await Bun.sleep(400)

    const finisher = Bun.spawn(['bun', 'run', FINISHER, dataDir, String(retroId)], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect(await finisher.exited).toBe(0)

    const stdout = await new Response(waiter.stdout).text()
    expect(await waiter.exited).toBe(0)

    const event = JSON.parse(stdout.trim()) as {
      kind: string
      retroId: number
      revision: number
      at: string
    }
    expect(event.kind).toBe('ReviewFinished')
    expect(event.retroId).toBe(retroId)
    expect(event.revision).toBe(1)
    expect(Number.isNaN(Date.parse(event.at))).toBe(false)
  },
  BUDGET_MS,
)

/** A port nobody holds. Asked of the OS and given straight back, as e2e does. */
async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('') })
  const port = probe.port ?? 0
  await probe.stop(true)
  return port
}

/** Blocks until `serve` has taken the stage, which is what `up` waits on too. */
async function waitForLock(dataDir: string): Promise<void> {
  const lockFile = join(dataDir, 'server.lock')
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (existsSync(lockFile)) return
    await Bun.sleep(25)
  }
  throw new Error('the server never took the stage lock')
}

/**
 * `review wait --follow` against a **real running server** (retro 10
 * `r-monitor-not-realtime`).
 *
 * This is the scenario the record is about, and the only place the whole chain
 * is real: three processes and no fakes anywhere — a `retro serve` with its
 * tailer, a `review wait --follow` subscribing to `events.onRetro` over SSE the
 * way every open page does, and a third process pressing Finish. Everything one
 * layer down mocks the server; nothing there can prove tRPC's wire format is
 * what the parser believes, and this is what does.
 *
 * **`via` is the discriminator, not the clock.** A store fallback would also
 * answer this quickly, so speed alone proves nothing about the channel; the
 * field says which one delivered, and the in-process suite proves the field is
 * honest by making each channel unable to answer in turn. The elapsed time is
 * asserted only against the class of latency the record was filed about — the
 * bridge's 20-second sleep — and reported as a number rather than a claim.
 */
test(
  'review wait --follow hears the finish over the server’s live stream',
  async () => {
    const { home, dataDir, retroId } = await seedStage()
    const port = await freePort()

    const server = Bun.spawn(
      ['bun', 'run', BIN, 'serve', '--home', home, '--port', String(port), '--json'],
      { stdout: 'pipe', stderr: 'pipe' },
    )

    try {
      await waitForLock(dataDir)

      const waiter = Bun.spawn(
        [
          'bun',
          'run',
          BIN,
          'review',
          'wait',
          '--follow',
          '--retro',
          String(retroId),
          '--home',
          home,
          '--timeout',
          String(WAIT_SECONDS),
          '--json',
        ],
        { stdout: 'pipe', stderr: 'pipe' },
      )

      // Let the waiter open the stage, read its cursor and connect, so what is
      // measured below is the push and not the subscriber's own startup.
      await Bun.sleep(1_500)

      const finisher = Bun.spawn(['bun', 'run', FINISHER, dataDir, String(retroId)], {
        stdout: 'pipe',
        stderr: 'pipe',
      })
      expect(await finisher.exited).toBe(0)
      const pressedAt = Date.now()

      const stdout = await new Response(waiter.stdout).text()
      const elapsedMs = Date.now() - pressedAt
      expect(await waiter.exited).toBe(0)

      const event = JSON.parse(stdout.trim()) as {
        kind: string
        retroId: number
        revision: number
        at: string
        via: string
      }
      expect(event.kind).toBe('ReviewFinished')
      expect(event.retroId).toBe(retroId)
      expect(event.revision).toBe(1)
      // The whole point of the record: the event came off the push channel the
      // pages use, not off a timer.
      expect(event.via).toBe('stream')
      // An upper bound that includes the waiter's own process teardown, and not
      // a performance assertion: what it asserts is that this is not the
      // 20-second class the record was filed about. Measured over 12 runs while
      // this lane was written — 234-262 ms, median ~250 — so the bound sits
      // roughly twenty times above what was observed, which is the room a
      // loaded machine needs and still four times under the sleep it replaced.
      expect(elapsedMs).toBeLessThan(5_000)
    } finally {
      server.kill('SIGTERM')
      await server.exited
    }

    // And the honest fallback, with the same real binary: the server is gone,
    // so the subscribing form answers out of the store and says so.
    const afterwards = Bun.spawn(
      [
        'bun',
        'run',
        BIN,
        'review',
        'wait',
        '--follow',
        '--retro',
        String(retroId),
        '--home',
        home,
        '--timeout',
        '10',
        '--json',
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    const fallback = JSON.parse((await new Response(afterwards.stdout).text()).trim()) as {
      kind: string
      via: string
    }
    expect(await afterwards.exited).toBe(0)
    expect(fallback).toMatchObject({ kind: 'ReviewFinished', via: 'store' })
  },
  BUDGET_MS,
)

/**
 * `RETRO_TEST_CLOCK` freezes time inside a spawned process (testing.md
 * §Determinism). Without it a test that shells out can only assert that a
 * timestamp parses; with it, the ledger a subprocess writes is exact.
 */
test(
  'a spawned process writes the timestamp RETRO_TEST_CLOCK pins',
  async () => {
    const { home, dataDir } = newHome('retro-clock-')
    const frozen = '2019-07-04T12:30:00.000Z'

    const create = Bun.spawn(
      [
        'bun',
        'run',
        BIN,
        'session',
        'create',
        '--claude-session',
        'uuid-frozen',
        '--project',
        'retro',
        '--cwd',
        '/tmp',
        '--home',
        home,
        '--json',
      ],
      { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, RETRO_TEST_CLOCK: frozen } },
    )
    expect(await create.exited).toBe(0)

    const store = openSqliteStore({ dataDir })
    const session = await store.sessions.findByClaudeSession('uuid-frozen')
    await store.close()

    expect(session?.startedAt).toBe(frozen)
  },
  BUDGET_MS,
)

/**
 * The other half of the same promise: a second process reads what the first one
 * wrote, through the file alone.
 */
test(
  'a second CLI process sees what the first one committed',
  async () => {
    const { home, dataDir } = newHome('retro-xproc-')

    const draft = join(dataDir, 'revision.json')
    writeFileSync(draft, aRevisionDraft())

    const create = Bun.spawn(
      [
        'bun',
        'run',
        BIN,
        'session',
        'create',
        '--claude-session',
        'uuid-two-processes',
        '--project',
        'retro',
        '--cwd',
        '/tmp',
        '--home',
        home,
        '--json',
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    expect(await create.exited).toBe(0)

    const submit = Bun.spawn(
      [
        'bun',
        'run',
        BIN,
        'revision',
        'create',
        '--session',
        'uuid-two-processes',
        '--file',
        draft,
        '--home',
        home,
        '--json',
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    expect(await submit.exited).toBe(0)

    const list = Bun.spawn(
      [
        'bun',
        'run',
        BIN,
        'record',
        'list',
        '--session',
        'uuid-two-processes',
        '--home',
        home,
        '--json',
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    const listed = JSON.parse((await new Response(list.stdout).text()).trim()) as {
      records: { rid: string; state: string }[]
    }

    expect(await list.exited).toBe(0)
    expect(listed.records).toEqual([
      expect.objectContaining({ rid: 'r-stale-lock', state: 'pending' }),
    ])
  },
  BUDGET_MS,
)
