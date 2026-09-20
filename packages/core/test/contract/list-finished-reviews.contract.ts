import { beforeEach, describe, expect, test } from 'bun:test'
import type { Store } from '#application/ports/store.port'
import type { RecordInput } from '#application/schemas/revision-input.schema'
import { aRecordInput } from '../support/fixtures'
import { createHarness, type Harness } from '../support/harness'
import type { StoreFactory } from './store.contract'

/**
 * `review.listFinished`, against every adapter (testing.md suite 1).
 *
 * A use case rather than a repository, and here for the reason `list-retros.contract.ts`
 * is: the row is a fold over five reads — an ordinal counted within a session, a
 * finish read out of the outbox and matched to the revision it belongs to, counts
 * derived from verdicts that may or may not still bind (D2). The two adapters
 * have every opportunity to disagree about that and no other suite would notice.
 *
 * The read is what an agent runs when it was not watching: `review wait` answers
 * about finishes that land while it blocks, and this answers about the ones that
 * already have.
 */
export function describeListFinishedReviewsContract(label: string, makeStore: StoreFactory): void {
  describe(`${label} · ListFinishedReviewsUseCase`, () => {
    let store: Store
    let harness: Harness

    beforeEach(async () => {
      store = await makeStore()
      harness = createHarness(store)
    })

    const list = async () =>
      (await harness.app.review.listFinished.execute({ actor: 'ai' })).reviews

    const startSession = async (claudeSession: string, cwd: string): Promise<number> =>
      (
        await harness.app.sessions.create.execute({
          actor: 'ai',
          claudeSession,
          cwd,
          branch: 'main',
          supervised: true,
        })
      ).session.id

    const fileRevision = async (
      sessionId: number,
      records: readonly Partial<RecordInput>[],
    ): Promise<number> =>
      (
        await harness.app.revisions.create.execute({
          actor: 'ai',
          session: sessionId,
          revision: {
            records: records.map((overrides, index) =>
              aRecordInput({ num: index + 1, rid: `r-record-${index + 1}`, ...overrides }),
            ),
          },
        })
      ).retroId

    test('lists nothing when no round has been put down', async () => {
      expect(await list()).toEqual([])

      const sessionId = await startSession('uuid-open', '/Users/sample/Developer/retro')
      await fileRevision(sessionId, [{}])

      expect(await list()).toEqual([])
    })

    /**
     * The whole row, against the shape the store actually holds in production: three
     * retrospectives across two sessions, one of each reading, and the two
     * orders that have to disagree — retro id ascending for the list, position
     * within the session for the ordinal.
     */
    test('lists each finished round oldest first, with its ordinal, state and counts', async () => {
      const first = await startSession('uuid-first', '/Users/sample/Developer/retro')
      const closed = await fileRevision(first, [{}, {}])
      await harness.decide(closed, 'r-record-1', 'approved')
      await harness.decide(closed, 'r-record-2', 'declined')
      harness.clock.advance(60_000)
      await harness.closeReview(closed)
      const closedAt = harness.clock.iso()

      // Somebody else's retrospective, still with the human — and started
      // between the two of the first session, so the ids interleave.
      const other = await startSession('uuid-other', '/Users/sample/Developer/hangar')
      const reviewing = await fileRevision(other, [{}])

      harness.clock.advance(60_000)
      const submitted = await fileRevision(first, [{}])
      await harness.decide(submitted, 'r-record-1', 'approved')
      harness.clock.advance(60_000)
      await harness.app.review.finish.execute({ actor: 'human', retro: { retroId: submitted } })
      const submittedAt = harness.clock.iso()

      expect(await list()).toEqual([
        {
          retroId: closed,
          retroNumber: 1,
          sessionId: first,
          claudeSession: 'uuid-first',
          finishedAt: closedAt,
          closed: true,
          revisionN: 1,
          counts: { pending: 0, approved: 1, declined: 1, revise: 0, hold: 0, total: 2 },
        },
        {
          retroId: submitted,
          retroNumber: 2,
          sessionId: first,
          claudeSession: 'uuid-first',
          finishedAt: submittedAt,
          // The window between his finish and the AI's close: `closed` is the
          // stored terminal state and nothing else writes it.
          closed: false,
          revisionN: 1,
          counts: { pending: 0, approved: 1, declined: 0, revise: 0, hold: 0, total: 1 },
        },
      ])
      expect((await list()).map((row) => row.retroId)).not.toContain(reviewing)
    })

    /**
     * The event outlives the round it was about. A retrospective finished on
     * revision 1 and answered with revision 2 is back with the human, and a
     * catching-up agent must not read it as something waiting on an answer it
     * has already given.
     */
    test('drops a retrospective whose finished round has been answered', async () => {
      const sessionId = await startSession('uuid-answered', '/Users/sample/Developer/retro')
      const retroId = await fileRevision(sessionId, [{}])
      await harness.finishRound(retroId)
      expect((await list()).map((row) => row.retroId)).toEqual([retroId])

      await fileRevision(sessionId, [{}])

      expect(await list()).toEqual([])
      // The finish is still in the outbox — what changed is which revision is
      // the latest, which is the only thing this read is asking about.
      expect(
        (await store.events.list({ names: ['ReviewFinished'] })).map((event) => event.revisionN),
      ).toEqual([1])
    })
  })
}
