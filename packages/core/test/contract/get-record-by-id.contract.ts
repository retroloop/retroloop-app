import { beforeEach, describe, expect, test } from 'bun:test'
import type { Store } from '#application/ports/store.port'
import type { RecordInput } from '#application/schemas/revision-input.schema'
import type { GetRecordByIdOutput } from '#application/use-cases/records/get-record-by-id.use-case'
import { createHarness, type Harness } from '../support/harness'
import type { StoreFactory } from './store.contract'

/**
 * `records.byId`, against every adapter (testing.md suite 1).
 *
 * Here for the reason `list-all-records.contract.ts` and
 * `list-retros.contract.ts` are: it is a use case rather than a repository, and
 * it is a **fold over six reads** — a number resolved backwards into the pair
 * that addresses a record, an ordinal counted within a session, the verdict in
 * effect against the latest draft, the lifecycle in force, and a timeline
 * stitched out of three tables that each keep their own clock. Proving that
 * against the memory store alone would leave the one thing worth proving
 * unproven: that the store used in production answers identically.
 *
 * The fixture is deliberately awkward — **two retrospectives that mint the same
 * rid**, a redraft that sends a decided record back to pending, and a record
 * whose lifecycle has been moved three times — because almost every bug this
 * read can have is a bug a one-retro, one-verdict, one-act fixture answers
 * correctly by accident.
 */
export function describeGetRecordByIdContract(label: string, makeStore: StoreFactory): void {
  describe(`${label} · GetRecordByIdUseCase`, () => {
    let store: Store
    let harness: Harness

    beforeEach(async () => {
      store = await makeStore()
      harness = createHarness(store)
    })

    const byId = async (id: number): Promise<GetRecordByIdOutput> =>
      harness.app.records.byId.execute({ actor: 'human', id })

    const startSession = async (claudeSession: string): Promise<number> =>
      (await harness.session(claudeSession)).id

    const fileRevision = async (
      sessionId: number,
      records: readonly Partial<RecordInput>[],
    ): Promise<number> => (await harness.revision(sessionId, records)).retroId

    /** The number the store minted for a record, which is what a URL carries. */
    const numberOf = async (retroId: number, rid: string): Promise<number> => {
      const minted = await store.recordIds.findByRecord(retroId, rid)
      if (minted === undefined) throw new Error(`record ${rid} of retro ${retroId} has no number`)
      return minted.id
    }

    test('is NOT_FOUND for a number nothing was ever minted for', async () => {
      const sessionId = await startSession('uuid-1')
      await fileRevision(sessionId, [{}])

      await expect(byId(2)).rejects.toThrow('record 2 not found')
      await expect(byId(9_999)).rejects.toThrow('record 9999 not found')
    })

    test('carries the record, its number, and where it happened', async () => {
      const sessionId = await startSession('uuid-1')
      const retroId = await fileRevision(sessionId, [{ rid: 'r-stale-lock', title: 'The lock' }])

      const answer = await byId(await numberOf(retroId, 'r-stale-lock'))

      expect(answer.retroId).toBe(retroId)
      expect(answer.retroNumber).toBe(1)
      expect(answer.session).toEqual({
        id: sessionId,
        cwd: '/Users/sample/Developer/retro',
        startedAt: harness.clock.iso(),
      })
      expect(answer.record.record.rid).toBe('r-stale-lock')
      expect(answer.record.record.title).toBe('The lock')
      expect(answer.record.globalId).toBe(1)
      expect(answer.record.revisionN).toBe(1)
      // Nobody has decided it and nobody has touched it: both axes read their
      // untouched position, and neither is a row anybody wrote.
      expect(answer.record.decision.state).toBe('pending')
      expect(answer.lifecycle.status).toBe('open')
    })

    /**
     * **The whole reason a global number exists.** A rid is minted per
     * retrospective (A5), so `r-stale-lock` names two different records here —
     * and a resolver that matched on the rid, or on a row's position, would open
     * one of them under the other's number.
     */
    test('two retrospectives minting the same rid are two records with two numbers', async () => {
      const sessionId = await startSession('uuid-1')
      const here = await fileRevision(sessionId, [{ rid: 'r-stale-lock', title: 'The first lock' }])
      await harness.decide(here, 'r-stale-lock', 'approved')
      await harness.closeReview(here)
      const there = await fileRevision(sessionId, [
        { rid: 'r-stale-lock', title: 'The lock, again' },
      ])

      const first = await byId(await numberOf(here, 'r-stale-lock'))
      const second = await byId(await numberOf(there, 'r-stale-lock'))

      expect(first.retroId).toBe(here)
      expect(first.record.record.title).toBe('The first lock')
      expect(second.retroId).toBe(there)
      expect(second.record.record.title).toBe('The lock, again')
      expect(second.record.globalId).not.toBe(first.record.globalId)
      // The second retrospective of the same session, which is what the
      // identity line prints — and it is a position rather than an id.
      expect(first.retroNumber).toBe(1)
      expect(second.retroNumber).toBe(2)
    })

    test('counts the retrospective within its own session, not across sessions', async () => {
      const first = await startSession('uuid-1')
      const firstRetro = await fileRevision(first, [{}])
      await harness.decide(firstRetro, 'r-record-1', 'approved')
      await harness.closeReview(firstRetro)
      await fileRevision(first, [{}])

      const second = await startSession('uuid-2')
      const elsewhere = await fileRevision(second, [{}])

      const answer = await byId(await numberOf(elsewhere, 'r-record-1'))
      expect(answer.session.id).toBe(second)
      expect(answer.retroNumber).toBe(1)
    })

    /**
     * The record is read at the **latest** revision, which is the revision
     * `records.listAll` lists and `setLifecycle` accepts a rid from — so
     * everything this page shows is something its own controls can act on. A
     * record a later draft withdrew is not part of the retrospective's outcome,
     * and it answers NotFound even though its number is still minted.
     */
    test('is NOT_FOUND for a record a later draft withdrew, number and all', async () => {
      const sessionId = await startSession('uuid-1')
      const retroId = await fileRevision(sessionId, [{ rid: 'r-one' }, { rid: 'r-two' }])
      const withdrawn = await numberOf(retroId, 'r-two')

      await harness.finishRound(retroId)
      await harness.revision(sessionId, [{ rid: 'r-one' }])

      expect((await byId(await numberOf(retroId, 'r-one'))).record.record.rid).toBe('r-one')
      await expect(byId(withdrawn)).rejects.toThrow(`record ${withdrawn} not found`)
    })

    test('reads the narrative of the latest draft, not of the one it was filed in', async () => {
      const sessionId = await startSession('uuid-1')
      const retroId = await fileRevision(sessionId, [{ problem: 'The first telling.' }])
      await harness.finishRound(retroId)
      await harness.revision(sessionId, [{ problem: 'The telling that stands.' }])

      const answer = await byId(await numberOf(retroId, 'r-record-1'))
      expect(answer.record.record.problem).toBe('The telling that stands.')
      expect(answer.record.revisionN).toBe(2)
    })

    /* ── the timeline ───────────────────────────────────────────────────────── */

    test('opens the timeline with the draft the record was filed in, authored by the AI', async () => {
      const sessionId = await startSession('uuid-1')
      const retroId = await fileRevision(sessionId, [{}])

      const answer = await byId(await numberOf(retroId, 'r-record-1'))
      expect(answer.timeline).toEqual([
        { kind: 'created', at: harness.clock.iso(), revisionN: 1, actor: 'ai' },
      ])
    })

    /**
     * A record the AI introduces in a **later** draft is created then, not at
     * revision 1 — the timeline says which draft it arrived in, and a
     * hard-coded 1 would be right for every record of every fixture but this
     * shape.
     */
    test('says which draft a record introduced later was filed in', async () => {
      const sessionId = await startSession('uuid-1')
      const retroId = await fileRevision(sessionId, [{ rid: 'r-one' }])
      await harness.finishRound(retroId)
      harness.clock.advance(60_000)
      const arrived = harness.clock.iso()
      await harness.revision(sessionId, [{ rid: 'r-one' }, { rid: 'r-two' }])

      const answer = await byId(await numberOf(retroId, 'r-two'))
      expect(answer.timeline).toEqual([{ kind: 'created', at: arrived, revisionN: 2, actor: 'ai' }])
    })

    /**
     * **Every verdict, not the one in force.** The effective decision on the
     * record says where it stands; the timeline says how it got there — and a
     * record approved against one draft, sent back to pending by a redraft and
     * approved again is the shape that makes the difference visible (D2). A
     * timeline showing only the latest would drop the first approval entirely,
     * which is the single most interesting thing this record's history has.
     */
    test('keeps every verdict the record was ever given, in the order they were given', async () => {
      const sessionId = await startSession('uuid-1')
      const retroId = await fileRevision(sessionId, [{ problem: 'The first telling.' }])
      const filedAt = harness.clock.iso()

      harness.clock.advance(60_000)
      const approvedAt = harness.clock.iso()
      await harness.decide(retroId, 'r-record-1', 'approved')

      // The record is already approved, so this writes no verdict of its own —
      // it is the Finish the next draft has to answer.
      await harness.finishRound(retroId)
      harness.clock.advance(60_000)
      const redraftedAt = harness.clock.iso()
      await harness.revision(sessionId, [{ problem: 'The telling that stands.' }])

      harness.clock.advance(60_000)
      const declinedAt = harness.clock.iso()
      await harness.decide(retroId, 'r-record-1', 'declined')

      const answer = await byId(await numberOf(retroId, 'r-record-1'))

      // The redraft is not an event on this list: what changed between two
      // drafts is the record's diff, which is a page of its own.
      expect(redraftedAt).not.toBe(declinedAt)
      expect(answer.timeline).toEqual([
        { kind: 'created', at: filedAt, revisionN: 1, actor: 'ai' },
        {
          kind: 'decision',
          at: approvedAt,
          revisionN: 1,
          state: 'approved',
          actor: 'human',
          version: 1,
        },
        {
          kind: 'decision',
          at: declinedAt,
          revisionN: 2,
          state: 'declined',
          actor: 'human',
          version: 2,
        },
      ])
      // And the record itself carries only the verdict in force.
      expect(answer.record.decision.state).toBe('declined')
    })

    /**
     * Every lifecycle act, with what it cited and who took it — the half of the
     * timeline that names events like status changes, and the reason
     * `record_lifecycle` was append-only from the first line.
     *
     * Both actors appear, because this is the one table both of them write: the
     * AI resolves what it fixed and the human takes it back.
     */
    test('keeps every lifecycle act, its references, its note and its author', async () => {
      const sessionId = await startSession('uuid-1')
      const retroId = await fileRevision(sessionId, [{}])
      await harness.decide(retroId, 'r-record-1', 'approved')
      await harness.closeReview(retroId)

      harness.clock.advance(60_000)
      const resolvedAt = harness.clock.iso()
      await harness.app.records.setLifecycle.execute({
        actor: 'ai',
        retro: { retroId },
        rid: 'r-record-1',
        status: 'resolved',
        refs: ['a1b2c3d', 'https://github.com/o/r/pull/42'],
        note: 'Landed on main.',
      })

      harness.clock.advance(60_000)
      const reopenedAt = harness.clock.iso()
      await harness.app.records.setLifecycle.execute({
        actor: 'human',
        retro: { retroId },
        rid: 'r-record-1',
        status: 'reopened',
      })

      harness.clock.advance(60_000)
      const archivedAt = harness.clock.iso()
      await harness.app.records.setLifecycle.execute({
        actor: 'human',
        retro: { retroId },
        rid: 'r-record-1',
        status: 'archived',
      })

      const answer = await byId(await numberOf(retroId, 'r-record-1'))

      expect(answer.timeline.filter((entry) => entry.kind === 'lifecycle')).toEqual([
        {
          kind: 'lifecycle',
          at: resolvedAt,
          status: 'resolved',
          actor: 'ai',
          refs: ['a1b2c3d', 'https://github.com/o/r/pull/42'],
          note: 'Landed on main.',
          version: 1,
        },
        {
          kind: 'lifecycle',
          at: reopenedAt,
          status: 'reopened',
          actor: 'human',
          refs: [],
          note: undefined,
          version: 2,
        },
        {
          kind: 'lifecycle',
          at: archivedAt,
          status: 'archived',
          actor: 'human',
          refs: [],
          note: undefined,
          version: 3,
        },
      ])
      // The act is what happened; the standing is where it left the record, and
      // the two are different vocabularies on purpose.
      expect(answer.lifecycle.status).toBe('archived')
      expect(answer.lifecycle.actor).toBe('human')
    })

    /**
     * The three kinds interleave by the clock rather than by kind — a record
     * resolved, reopened *and then decided again* is out of order under any
     * grouping that put every verdict before every lifecycle act.
     */
    test('orders the three kinds of event by when they happened, not by what they are', async () => {
      const sessionId = await startSession('uuid-1')
      const retroId = await fileRevision(sessionId, [{}])
      const filedAt = harness.clock.iso()

      harness.clock.advance(60_000)
      const approvedAt = harness.clock.iso()
      await harness.decide(retroId, 'r-record-1', 'approved')

      harness.clock.advance(60_000)
      const resolvedAt = harness.clock.iso()
      await harness.app.records.setLifecycle.execute({
        actor: 'ai',
        retro: { retroId },
        rid: 'r-record-1',
        status: 'resolved',
        refs: ['a1b2c3d'],
      })

      harness.clock.advance(60_000)
      const declinedAt = harness.clock.iso()
      await harness.decide(retroId, 'r-record-1', 'declined')

      const answer = await byId(await numberOf(retroId, 'r-record-1'))

      expect(answer.timeline.map((entry) => [entry.kind, entry.at])).toEqual([
        ['created', filedAt],
        ['decision', approvedAt],
        ['lifecycle', resolvedAt],
        ['decision', declinedAt],
      ])
    })

    /**
     * **A declined record is archived from birth, and nothing wrote a row saying
     * so** (`record-lifecycle.service.ts`). So the standing says `archived` while
     * the timeline holds no lifecycle event at all — which is the truth: the
     * decline is what put it there, and it is on the timeline as the verdict it
     * was.
     */
    test('shows a declined record archived with nothing on the timeline that archived it', async () => {
      const sessionId = await startSession('uuid-1')
      const retroId = await fileRevision(sessionId, [{}])
      await harness.decide(retroId, 'r-record-1', 'declined')

      const answer = await byId(await numberOf(retroId, 'r-record-1'))

      expect(answer.lifecycle.status).toBe('archived')
      expect(answer.lifecycle.actor).toBeUndefined()
      expect(answer.timeline.some((entry) => entry.kind === 'lifecycle')).toBe(false)
      expect(answer.timeline.map((entry) => entry.kind)).toEqual(['created', 'decision'])
    })

    /**
     * A frozen clock is not a bug in the fixture, it is the shape of a store
     * where two acts land inside one second — and the timeline still has to
     * come back in the order the acts can only have happened in. The sort is
     * stable over a construction order that is already causal, which is what
     * makes this hold rather than luck.
     */
    test('keeps the causal order when two acts share a timestamp', async () => {
      const sessionId = await startSession('uuid-1')
      const retroId = await fileRevision(sessionId, [{}])
      await harness.decide(retroId, 'r-record-1', 'approved')
      await harness.closeReview(retroId)
      await harness.app.records.setLifecycle.execute({
        actor: 'ai',
        retro: { retroId },
        rid: 'r-record-1',
        status: 'resolved',
        refs: ['a1b2c3d'],
      })

      const answer = await byId(await numberOf(retroId, 'r-record-1'))

      expect(new Set(answer.timeline.map((entry) => entry.at)).size).toBe(1)
      expect(answer.timeline.map((entry) => entry.kind)).toEqual([
        'created',
        'decision',
        'lifecycle',
      ])
    })

    /**
     * The timeline is one record's, and a rid minted in two retrospectives is
     * the one arrangement where a query that forgot half the key would hand one
     * record the other's history.
     */
    test('never lets one retrospective’s acts appear on another record’s timeline', async () => {
      const sessionId = await startSession('uuid-1')
      const here = await fileRevision(sessionId, [{ rid: 'r-stale-lock' }])
      await harness.decide(here, 'r-stale-lock', 'approved')
      await harness.closeReview(here)
      await harness.app.records.setLifecycle.execute({
        actor: 'ai',
        retro: { retroId: here },
        rid: 'r-stale-lock',
        status: 'resolved',
        refs: ['a1b2c3d'],
      })

      const there = await fileRevision(sessionId, [{ rid: 'r-stale-lock' }])

      const untouched = await byId(await numberOf(there, 'r-stale-lock'))
      expect(untouched.lifecycle.status).toBe('open')
      expect(untouched.timeline.map((entry) => entry.kind)).toEqual(['created'])

      const fixed = await byId(await numberOf(here, 'r-stale-lock'))
      expect(fixed.timeline.map((entry) => entry.kind)).toEqual([
        'created',
        'decision',
        'lifecycle',
      ])
    })
  })
}
