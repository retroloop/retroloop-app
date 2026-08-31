import { beforeEach, describe, expect, test } from 'bun:test'
import type { Store } from '#application/ports/store.port'
import type { RecordInput } from '#application/schemas/revision-input.schema'
import { aRecordInput } from '../support/fixtures'
import { createHarness, type Harness } from '../support/harness'
import type { StoreFactory } from './store.contract'

/**
 * `retros.list`, against every adapter (testing.md suite 1).
 *
 * The suites beside this one are per repository; this one is a use case, and it
 * is here for the same reason they are. The dashboard's row is assembled from
 * four reads and a fold over their results — an ordinal counted within a
 * session, a name taken from the newest draft, counts derived from verdicts that
 * may or may not still bind (D2). Proving that against the memory store alone
 * would leave the one thing worth proving unproven: that the store the owner
 * actually runs answers identically.
 */
export function describeListRetrosContract(label: string, makeStore: StoreFactory): void {
  describe(`${label} · ListRetrosUseCase`, () => {
    let store: Store
    let harness: Harness

    beforeEach(async () => {
      store = await makeStore()
      harness = createHarness(store)
    })

    const list = async () => (await harness.app.retros.list.execute({ actor: 'ai' })).retros

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
      title?: string,
    ): Promise<number> =>
      (
        await harness.app.revisions.create.execute({
          actor: 'ai',
          session: sessionId,
          revision: {
            title,
            records: records.map((overrides, index) =>
              aRecordInput({ num: index + 1, rid: `r-record-${index + 1}`, ...overrides }),
            ),
          },
        })
      ).retroId

    /** Decides every record and finishes, so the session's next revision starts a new retro. */
    const finishRetro = async (retroId: number, rids: readonly string[]): Promise<void> => {
      for (const rid of rids) await harness.decide(retroId, rid, 'approved')
      await harness.closeReview(retroId)
    }

    test('lists nothing when nothing has been retrospected', async () => {
      expect(await list()).toEqual([])
    })

    /**
     * Newest first is retro id descending, and the ordinal is the position
     * *within the session* (KC-0011) — so the newest row can be "#1" while an
     * older one is "#2", which is exactly the distinction the identity line
     * exists to draw.
     */
    test('lists every session’s retrospectives together, newest first, numbered per session', async () => {
      const first = await startSession('uuid-first', '/Users/haider/Developer/retro')
      const firstRetro = await fileRevision(first, [{}, {}], 'The lock that outlived its process')
      await finishRetro(firstRetro, ['r-record-1', 'r-record-2'])
      const secondRetro = await fileRevision(first, [{}, {}, {}])

      const other = await startSession('uuid-other', '/Users/haider/Developer/harbor')
      const otherRetro = await fileRevision(other, [{}], 'Elsewhere entirely')

      const retros = await list()

      expect(retros.map((retro) => retro.retroId)).toEqual([otherRetro, secondRetro, firstRetro])
      expect(retros.map((retro) => retro.retroNumber)).toEqual([1, 2, 1])
      expect(retros.map((retro) => retro.session.id)).toEqual([other, first, first])
      expect(retros.map((retro) => retro.session.cwd)).toEqual([
        '/Users/haider/Developer/harbor',
        '/Users/haider/Developer/retro',
        '/Users/haider/Developer/retro',
      ])
      expect(retros.map((retro) => retro.state)).toEqual(['reviewing', 'reviewing', 'finished'])
      expect(retros.map((retro) => retro.title)).toEqual([
        'Elsewhere entirely',
        undefined,
        'The lock that outlived its process',
      ])
      expect(retros[0]?.session.startedAt).toBe(harness.clock.iso())
    })

    /**
     * The counts are effective states, not stored ones (D2): a verdict given
     * against a revision carries into the next one while the narrative is
     * unchanged, and stops binding the moment the AI rewrites the record.
     */
    test('counts the latest revision’s records by their effective state', async () => {
      const sessionId = await startSession('uuid-counts', '/Users/haider/Developer/retro')
      const retroId = await fileRevision(sessionId, [{}, {}, {}])

      expect((await list())[0]?.counts).toEqual({ pending: 3, decided: 0 })

      await harness.decide(retroId, 'r-record-1', 'approved')
      await harness.decide(retroId, 'r-record-2', 'declined')
      expect((await list())[0]?.counts).toEqual({ pending: 1, decided: 2 })

      // The round is put down before the next draft may answer it (#113
      // `r-revision-sneaks-past-review`), and the finish gate wants a verdict on
      // the third record too — so all three are decided going in.
      await harness.finishRound(retroId)
      expect((await list())[0]?.counts).toEqual({ pending: 0, decided: 3 })

      // The next draft rewrites the first record: its verdict no longer binds,
      // and the two it left alone carry over.
      await fileRevision(sessionId, [
        { problem: 'The lock outlives its process, and every later start pays for it.' },
        {},
        {},
      ])
      expect((await list())[0]?.counts).toEqual({ pending: 1, decided: 2 })
    })

    /**
     * The latest revision's title wins, and silence in a later draft is not a
     * vote for the previous answer (KC-0010, KC-0020). The "Retro #n — <cwd
     * basename>" fallback is the reader's, not this row's: absent stays absent.
     */
    test('takes its name from the latest revision, and has none when that revision proposed none', async () => {
      const sessionId = await startSession('uuid-title', '/Users/haider/Developer/retro')
      const retroId = await fileRevision(sessionId, [{}], 'The first name it was given')
      expect((await list())[0]?.title).toBe('The first name it was given')

      await harness.finishRound(retroId)
      await fileRevision(sessionId, [{}])
      expect((await list())[0]?.title).toBeUndefined()
    })

    /**
     * The fourth word on the dashboard's own row (the owner's session-11 add),
     * against the store he actually runs — which is the reason this suite is a
     * contract rather than a unit test. `submitted` is the only value on this
     * row with no column behind it: it is read out of the `ReviewFinished`
     * events by the fifth read this use case was widened to make, and an adapter
     * whose events table answered that filter differently would be invisible
     * anywhere else.
     *
     * All three readings in one walk, because the boundaries are the claim.
     */
    test('reads submitted between his finish and the AI’s close, and only there', async () => {
      const sessionId = await startSession('uuid-submitted', '/Users/haider/Developer/retro')
      const retroId = await fileRevision(sessionId, [{}])
      const state = async () => (await list())[0]?.state

      expect(await state()).toBe('reviewing')

      await harness.finishRound(retroId)
      expect(await state()).toBe('submitted')
      // Still `reviewing` in the store: the row the adapter holds never learns
      // this word (`retro.view.ts`).
      expect((await store.retrospectives.findById(retroId))?.state).toBe('reviewing')

      await harness.closeReview(retroId)
      expect(await state()).toBe('finished')
    })

    /**
     * One events read for the whole list, and it has to land the finishes on the
     * right retrospectives: two sessions, one finished round, and the row that
     * did not finish must not inherit the word from the row that did.
     */
    test('attributes each finished round to its own retrospective', async () => {
      const first = await startSession('uuid-a', '/Users/haider/Developer/retro')
      const finished = await fileRevision(first, [{}])
      const other = await startSession('uuid-b', '/Users/haider/Developer/harbor')
      const untouched = await fileRevision(other, [{}])
      await harness.finishRound(finished)

      const retros = await list()

      expect(retros.map((retro) => [retro.retroId, retro.state])).toEqual([
        [untouched, 'reviewing'],
        [finished, 'submitted'],
      ])
    })

    /**
     * A retrospective with no revision cannot be produced through the use cases —
     * `revision create` writes both in one unit of work — but it is representable
     * in the store, and a read model that threw on one would take the whole
     * dashboard down with it.
     */
    test('reports a retrospective that has no revision at all', async () => {
      const sessionId = await startSession('uuid-bare', '/Users/haider/Developer/retro')
      const bare = await store.retrospectives.add({
        sessionId,
        state: 'open',
        startedAt: harness.clock.iso(),
        finishedAt: undefined,
      })

      expect(await list()).toEqual([
        {
          retroId: bare.id,
          retroNumber: 1,
          title: undefined,
          state: 'open',
          counts: { pending: 0, decided: 0 },
          session: {
            id: sessionId,
            cwd: '/Users/haider/Developer/retro',
            startedAt: harness.clock.iso(),
          },
        },
      ])
    })
  })
}
