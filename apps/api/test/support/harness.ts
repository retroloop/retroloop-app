import {
  type App,
  type Clock,
  createApp,
  createMemoryStore,
  type LegacyRecord,
  type RecordInput,
  type Store,
} from '@retro/core'
import { createTailer, type Tailer } from '#events/tailer'
import { createCaller } from '#trpc/router'

export type ApiHarness = {
  readonly app: App
  readonly store: Store
  readonly tailer: Tailer
  readonly clock: MovableClock
  readonly caller: ReturnType<typeof createCaller>
  /** Registers a session and returns its id. */
  session(claudeSession?: string): Promise<number>
  /** Submits a revision and returns the retrospective id. */
  revision(sessionId: number, records?: readonly Partial<RecordInput>[]): Promise<number>
  /**
   * A retrospective holding one record in the shape written before solutions
   * existed — retros 1–5 are full of them, and the wire has to keep rendering
   * one.
   *
   * Straight to the repository, because the write path takes the new shape and
   * nothing else; the repository takes the domain type, whose legacy branch is
   * the JSON an earlier binary left in the blob.
   */
  legacyRevision(sessionId: number): Promise<{ retroId: number; record: LegacyRecord }>
  /**
   * The human's half of one round: decide whatever is still pending, then press
   * Finish.
   *
   * A second revision may only answer a finished round
   * (`r-revision-sneaks-past-review`), so a test that wants two revisions runs the
   * rhythm. It approves what is pending because the finish gate wants an answer
   * on every record and these tests' subject is the wire, not the verdicts.
   */
  finishRound(retroId: number): Promise<void>
  /**
   * The end of the loop, both halves. The human's Finish closes their side of
   * the round and the AI's close is what finishes a retrospective
   * (`r-one-finish-button`), so a test that needs a finished one runs both —
   * the second through the App, because there is no procedure for it.
   */
  closeReview(retroId: number): Promise<void>
}

/**
 * Frozen until a test moves it (testing.md §Determinism) — the same shape the
 * core suite's `FakeClock` has, and here for the same reason it is there.
 *
 * It stayed a bare `Clock` for as long as nothing on this wire carried a moment
 * a reader compares to another one. `records.byId`'s timeline does: it is a list
 * ordered by time, and a suite that could only write a store where everything
 * happened at 09:00 would be asserting an order no timestamp in it disagrees
 * with (`r-assertion-value-distinctiveness`).
 */
export type MovableClock = Clock & {
  /** What `now()` currently returns, as the ledger stores it. */
  iso(): string
  set(iso: string): void
}

function frozenClock(start = '2026-08-24T09:00:00.000Z'): MovableClock {
  let instant = new Date(start)
  return {
    now: () => new Date(instant),
    iso: () => instant.toISOString(),
    set: (iso) => {
      instant = new Date(iso)
    },
  }
}

/** A revision draft satisfying every mechanical rule of the schema (D5). */
export function aRecord(overrides: Partial<RecordInput> = {}): RecordInput {
  return {
    rid: 'r-stale-lock',
    num: 1,
    title: 'Deploy blocked on a stale lock file',
    type: 'issue',
    problem: 'The deploy waited 40 minutes on a lock nothing held.',
    humanWords: [
      {
        verbatim: 'this thing has been sitting there for ages',
        cleaned: 'This has been sitting there for a long time.',
        context: 'while watching the deploy log',
      },
    ],
    rootCause: {
      whatHappened: 'The lock file outlived the process that took it.',
      whys: ['The process was killed', 'The lock had no owner check'],
      root: 'Locks are advisory with no liveness check.',
    },
    diagnosticData:
      '- **The lock file:** `stage.lock`, 0 bytes, written 40 minutes before the deploy.\n' +
      '- **The holder:** `ps 8123` — no such process.',
    workaround: 'Delete the lock file by hand.',
    solutions: [
      {
        bullets: '- **Document the lock.** Say in the runbook which process owns it.',
        footprint: 'docs/runbook.md',
        level: 1,
        recommended: false,
      },
      {
        bullets: '- **Write the holder PID.** Check liveness before waiting on the lock.',
        footprint: '- scripts/deploy.sh\n- lib/lock.ts',
        level: 2,
        recommended: true,
      },
    ],
    requester: 'human',
    impacts: 'human',
    defaults: { severity: 3, involvement: 'pull-request' },
    ...overrides,
  }
}

/**
 * The same record as it was filed before solutions existed: one direction, one
 * footprint, a proposed level of its own.
 *
 * There is no builder for it over `aRecord`, because nothing may author this
 * shape any more — it is a stored blob, and this is what one looks like.
 */
export function aLegacyRecord(overrides: Partial<LegacyRecord> = {}): LegacyRecord {
  const {
    solutions: _solutions,
    // A record filed then carried no diagnostic data, and taking it off here is
    // what makes this fixture a record an older binary actually wrote rather
    // than a new one with two keys renamed.
    diagnosticData: _diagnosticData,
    defaults,
    humanWords,
    ...shared
  } = aRecord()
  return {
    ...shared,
    diagnosticData: undefined,
    // The input type's `context` is optional; the stored record's is required
    // and may be undefined, which is the one difference between the two.
    humanWords: humanWords.map((words) => ({
      verbatim: words.verbatim,
      cleaned: words.cleaned,
      context: words.context,
    })),
    rid: 'r-old-shape',
    agreedDirection: 'Write the holder PID into the lock and check liveness. (agreed)',
    footprint: '- scripts/deploy.sh\n- lib/lock.ts',
    defaults: { ...defaults, solutionLevel: 2 },
    ...overrides,
  }
}

/**
 * The server against the memory store (testing.md suite 2).
 *
 * `createCaller` runs the real routers, the real context and the real error
 * middleware with no HTTP in the way — so what these tests exercise is the
 * server's behaviour, not a rehearsal of it, and the only thing faked is L1.
 *
 * The tailer here is driven by hand (`tailer.poll()`) rather than by its timer:
 * a test that waits 300 ms for a loop tick is a test that flakes on a busy
 * machine, and `retries: 0` is law.
 */
export function createApiHarness(): ApiHarness {
  const clock = frozenClock()
  const store = createMemoryStore()
  const app = createApp(store, { clock })
  const tailer = createTailer(store, { clock })
  const caller = createCaller({ app, tailer })

  return {
    app,
    store,
    tailer,
    clock,
    caller,
    async session(claudeSession = 'uuid-1') {
      const { session } = await app.sessions.create.execute({
        actor: 'ai',
        claudeSession,
        project: 'retro',
        cwd: '/Users/sample/Developer/retro',
        branch: 'main',
        supervised: true,
      })
      return session.id
    },
    async finishRound(retroId) {
      const listed = await caller.records.list({ retroId })
      for (const record of listed.records) {
        if (record.state !== 'pending') continue
        // Against the revision being listed, which is the one the reviewer is on
        // — a verdict binds to the draft it was given against (D2).
        await caller.decisions.record({
          retroId,
          rid: record.rid,
          revision: listed.revision,
          state: 'approved',
        })
      }
      await caller.review.finish({ retroId })
    },
    async closeReview(retroId) {
      await caller.review.finish({ retroId })
      await app.review.close.execute({ actor: 'ai', retro: { retroId } })
    },
    async revision(sessionId, records = [{}]) {
      const { retroId } = await app.revisions.create.execute({
        actor: 'ai',
        session: sessionId,
        revision: {
          records: records.map((overrides, index) =>
            aRecord({ num: index + 1, rid: `r-record-${index + 1}`, ...overrides }),
          ),
        },
      })
      return retroId
    },
    async legacyRevision(sessionId) {
      const at = clock.now().toISOString()
      const retro = await store.retrospectives.add({
        sessionId,
        state: 'reviewing',
        startedAt: at,
        finishedAt: undefined,
      })
      const record = aLegacyRecord()
      await store.revisions.add({
        retroId: retro.id,
        n: 1,
        createdAt: at,
        title: undefined,
        records: [record],
      })
      // And its global number, which on a real store the migration would have
      // minted: this helper writes straight to the repositories, so it owes what
      // the write path and the migration between them guarantee.
      await store.recordIds.add({ retroId: retro.id, rid: record.rid })
      return { retroId: retro.id, record }
    },
  }
}
