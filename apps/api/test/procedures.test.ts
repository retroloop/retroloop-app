import { beforeEach, describe, expect, test } from 'bun:test'
import { hashRecordContent, type RetroRecord } from '@retro/core'
import type { TRPCError } from '@trpc/server'
import { pendingRidsOf } from '#trpc/errors'
import { appRouter } from '#trpc/router'
import { type ApiHarness, aRecord, createApiHarness } from './support/harness'

/** The code a caller saw, or the failure of a call that should have failed. */
async function codeOf(call: () => Promise<unknown>): Promise<string> {
  try {
    await call()
  } catch (error) {
    return (error as TRPCError).code
  }
  throw new Error('expected the call to fail, and it did not')
}

describe('the tRPC surface', () => {
  let api: ApiHarness
  let sessionId: number
  let retroId: number

  beforeEach(async () => {
    api = createApiHarness()
    sessionId = await api.session()
    retroId = await api.revision(sessionId, [{}, {}])
  })

  /**
   * The procedure set is the contract item 6's typed mock mirrors key for key
   * (R-MOCK-LOCK). A thirtieth procedure is a thirtieth thing to
   * mock, so adding one has to mean editing this list on purpose.
   *
   * Two removals of retro 4 are asserted here by absence, and this list is where
   * they are asserted: `requests.*`, the ask channel that duplicated the
   * review's comment threads (`r-remove-requests`), and `holds.*`, the lifecycle
   * flag `involvement` already expressed (`r-remove-hold`). A procedure that
   * came back would fail here by name.
   *
   * **`records.setLifecycle` is not `holds.*` coming back.** A hold was a
   * position on the verdict axis and the owner removed it because `involvement`
   * already said that; this is a second axis entirely, written after the verdict
   * is settled and the review is closed, and it is the thing he asked for by
   * name in session 8.
   */
  test('is the fourteen of session 9, session 10’s vocabularies and settings, the un-retire pair, and records.relate', () => {
    expect(Object.keys(appRouter._def.procedures).sort()).toEqual([
      'attributes.define',
      'attributes.list',
      'attributes.rename',
      'attributes.retire',
      'attributes.set',
      // The pair that closed retro-11 `r-retire-burns-a-word`: retiring was one
      // press with no way back, and the store never frees a retired name.
      'attributes.unretire',
      'decisions.record',
      'events.onRetro',
      'labels.define',
      'labels.list',
      'labels.rename',
      'labels.retire',
      'labels.set',
      'labels.unretire',
      'records.byId',
      'records.get',
      'records.list',
      'records.listAll',
      // Session 11's relation, arriving in session 13: one procedure for both
      // acts, and the only record write here that names *two* records — by the
      // global number, because a relation crosses retrospectives and the pair
      // that addresses one record is not a handle for two.
      'records.relate',
      'records.setLifecycle',
      'retros.get',
      'retros.list',
      'review.finish',
      'settings.get',
      'settings.setAiConfigWrite',
      'threads.list',
      'threads.open',
      'threads.reply',
      'threads.resolve',
    ])
  })

  describe('retros.get', () => {
    test('returns the identity line, the state and the revision list', async () => {
      const retro = await api.caller.retros.get({ retroId })

      expect(retro).toEqual({
        retroId,
        // The same session shape `retros.list` carries, so the review page and a
        // dashboard row state one identity line rather than two (N1).
        session: {
          id: sessionId,
          cwd: '/Users/haider/Developer/retro',
          startedAt: '2026-08-24T09:00:00.000Z',
        },
        project: 'retro',
        title: null,
        retroNumber: 1,
        state: 'reviewing',
        startedAt: '2026-08-24T09:00:00.000Z',
        finishedAt: null,
        latestRevision: 1,
        revisions: [{ n: 1, createdAt: '2026-08-24T09:00:00.000Z', records: 2, finishedAt: null }],
      })
    })

    /**
     * The owner's session-11 add, on the wire: *"There should be a status in
     * between that indicates that the human has submitted but AI hasn't
     * closed"*. Three readings of the same unchanged column, walked in one
     * test because the point of the fourth word is the *boundaries* — a
     * derivation that fired one press early or one press late would still pass
     * two of these three.
     *
     * The store is read at the same three moments. `submitted` must not have
     * become a row: if it ever does, this is where a migration nobody asked for
     * shows up.
     */
    test('reads submitted between his finish and the AI’s close, and only there', async () => {
      const storedState = async () => (await api.store.retrospectives.findById(retroId))?.state
      const wireState = async () => (await api.caller.retros.get({ retroId })).state

      expect(await wireState()).toBe('reviewing')
      expect(await storedState()).toBe('reviewing')

      await api.finishRound(retroId)
      expect(await wireState()).toBe('submitted')
      // The whole of the gap: the retrospective has not moved, and the round
      // it is waiting on is the one he just put down.
      expect(await storedState()).toBe('reviewing')
      expect((await api.caller.retros.get({ retroId })).revisions.at(-1)?.finishedAt).not.toBeNull()

      await api.app.review.close.execute({ actor: 'ai', retro: { retroId } })
      expect(await wireState()).toBe('finished')
      expect(await storedState()).toBe('finished')
    })

    /**
     * The round that counts is the **latest** one. A retro he finished and the
     * AI answered with a new draft is his again, and a derivation reading "any
     * finished round" rather than "the current one" would leave it reading
     * SUBMITTED for the rest of its life.
     */
    test('goes back to reviewing when the AI answers the round with a new revision', async () => {
      await api.finishRound(retroId)
      expect((await api.caller.retros.get({ retroId })).state).toBe('submitted')

      await api.app.revisions.create.execute({
        actor: 'ai',
        session: sessionId,
        revision: { records: [aRecord({ rid: 'r-record-1', num: 1 })] },
      })

      expect((await api.caller.retros.get({ retroId })).state).toBe('reviewing')
    })

    /**
     * The retro's name is the **latest** revision's title (KC-0020). A title
     * rides on a draft, so redrafting is how it changes — and a page reading an
     * older revision's name after the AI renamed the retro would be showing a
     * name nobody chose.
     */
    test('carries the latest revision’s title, and null when that revision has none', async () => {
      expect((await api.caller.retros.get({ retroId })).title).toBeNull()

      await api.finishRound(retroId)
      await api.app.revisions.create.execute({
        actor: 'ai',
        session: sessionId,
        revision: {
          title: 'The lock that outlived its process',
          records: [aRecord({ rid: 'r-record-1', num: 1 })],
        },
      })
      expect((await api.caller.retros.get({ retroId })).title).toBe(
        'The lock that outlived its process',
      )

      // A later draft that proposes no title leaves the retro without one:
      // latest wins, and silence is not a vote for the previous answer (KC-0010).
      await api.finishRound(retroId)
      await api.app.revisions.create.execute({
        actor: 'ai',
        session: sessionId,
        revision: { records: [aRecord({ rid: 'r-record-1', num: 1 })] },
      })
      expect((await api.caller.retros.get({ retroId })).title).toBeNull()
    })

    test('counts the retrospective within its session', async () => {
      // Decide both records so the gate lets the review finish, then start another.
      for (const rid of ['r-record-1', 'r-record-2']) {
        await api.caller.decisions.record({ retroId, rid, revision: 1, state: 'approved' })
      }
      await api.closeReview(retroId)
      const second = await api.revision(sessionId)

      expect((await api.caller.retros.get({ retroId: second })).retroNumber).toBe(2)
    })

    test('is NOT_FOUND for a retrospective that does not exist', async () => {
      expect(await codeOf(() => api.caller.retros.get({ retroId: 404 }))).toBe('NOT_FOUND')
    })

    test('is BAD_REQUEST when the input is the wrong shape', async () => {
      expect(await codeOf(() => api.caller.retros.get({ retroId: 'one' } as never))).toBe(
        'BAD_REQUEST',
      )
    })
  })

  describe('retros.list', () => {
    /** A second session, so the list has something to cross (KC-0020). */
    const anotherSession = async (cwd: string): Promise<number> =>
      (
        await api.app.sessions.create.execute({
          actor: 'ai',
          claudeSession: 'uuid-2',
          cwd,
          supervised: false,
        })
      ).session.id

    test('returns every retrospective, newest first, with its identity line and counts', async () => {
      await api.caller.decisions.record({
        retroId,
        rid: 'r-record-1',
        revision: 1,
        state: 'approved',
      })
      const elsewhere = await anotherSession('/Users/haider/Developer/harbor')
      const { retroId: elsewhereRetro } = await api.app.revisions.create.execute({
        actor: 'ai',
        session: elsewhere,
        revision: {
          title: 'Elsewhere entirely',
          records: [aRecord({ rid: 'r-record-1', num: 1 })],
        },
      })

      expect(await api.caller.retros.list({})).toEqual([
        {
          retroId: elsewhereRetro,
          retroNumber: 1,
          title: 'Elsewhere entirely',
          state: 'reviewing',
          counts: { pending: 1, decided: 0 },
          session: {
            id: elsewhere,
            cwd: '/Users/haider/Developer/harbor',
            startedAt: '2026-08-24T09:00:00.000Z',
          },
        },
        {
          // The session created by the harness carries a project; the row does
          // not, because nothing groups or filters by one (N2).
          retroId,
          retroNumber: 1,
          title: null,
          state: 'reviewing',
          counts: { pending: 1, decided: 1 },
          session: {
            id: sessionId,
            cwd: '/Users/haider/Developer/retro',
            startedAt: '2026-08-24T09:00:00.000Z',
          },
        },
      ])
    })

    /**
     * The ordinal is per session and the id is global, which is the whole reason
     * both are on the row: the newest retrospective here is "#2", and a newer one
     * in another session would still be "#1" (KC-0011).
     */
    test('numbers each retrospective within its own session', async () => {
      for (const rid of ['r-record-1', 'r-record-2']) {
        await api.caller.decisions.record({ retroId, rid, revision: 1, state: 'approved' })
      }
      await api.closeReview(retroId)
      const second = await api.revision(sessionId)

      const retros = await api.caller.retros.list({})

      expect(retros.map((retro) => [retro.retroId, retro.retroNumber])).toEqual([
        [second, 2],
        [retroId, 1],
      ])
      expect(retros.map((retro) => retro.state)).toEqual(['reviewing', 'finished'])
      expect(retros.map((retro) => retro.counts)).toEqual([
        { pending: 1, decided: 0 },
        { pending: 0, decided: 2 },
      ])
    })

    /**
     * The dashboard row and the review page say the same word about the same
     * retrospective — the invariant `retro-state.tsx` exists for, asserted
     * against both procedures at the one moment they could disagree, because
     * `retros.list` derives it from a cross-retro events read and `retros.get`
     * from the per-revision one the review page was already given.
     */
    test('the row reads submitted in the same window the review page does', async () => {
      await api.finishRound(retroId)

      const [row] = await api.caller.retros.list({})

      expect(row?.state).toBe('submitted')
      expect(row?.state).toBe((await api.caller.retros.get({ retroId })).state)
    })

    /**
     * One events read, whatever the number of rows — the pin
     * `list-retros.use-case.ts` widened from four reads to five and not to one
     * per retrospective. Two retros, one finished round between them, and the
     * finish must land on exactly the one that was finished.
     */
    test('finds the finished round of each retrospective without confusing them', async () => {
      const elsewhere = await anotherSession('/Users/haider/Developer/harbor')
      const { retroId: elsewhereRetro } = await api.app.revisions.create.execute({
        actor: 'ai',
        session: elsewhere,
        revision: { records: [aRecord({ rid: 'r-record-1', num: 1 })] },
      })
      await api.finishRound(retroId)

      const rows = await api.caller.retros.list({})

      expect(rows.map((retro) => [retro.retroId, retro.state])).toEqual([
        [elsewhereRetro, 'reviewing'],
        [retroId, 'submitted'],
      ])
    })

    test('is an empty list before anything has been retrospected', async () => {
      expect(await createApiHarness().caller.retros.list({})).toEqual([])
    })

    test('is BAD_REQUEST when the input carries anything at all', async () => {
      expect(await codeOf(() => api.caller.retros.list({ sessionId } as never))).toBe('BAD_REQUEST')
    })
  })

  describe('records.list', () => {
    test('returns the column with effective states and the pending count', async () => {
      const listed = await api.caller.records.list({ retroId })

      expect(listed).toEqual({
        retroId,
        revision: 1,
        pending: 2,
        records: [
          {
            rid: 'r-record-1',
            // The number the column prints: this store's first record ever, so
            // the sequence opens at 1 and agrees with `num` here. The two part
            // company in `records.listAll` below, where a second retrospective's
            // records are `num` 1 and 2 again.
            globalId: 1,
            num: 1,
            title: 'Deploy blocked on a stale lock file',
            type: 'issue',
            // On the summary since `r-additional-filters`: the bar counts by it.
            requester: 'human',
            state: 'pending',
            decidedOnRevision: null,
            carriedOver: false,
            contentChangedSince: null,
            // On the summary since #103, the same shape `records.listAll` sends.
            lifecycle: { status: 'open', refs: [], note: null, actor: null, at: null },
          },
          {
            rid: 'r-record-2',
            globalId: 2,
            num: 2,
            title: 'Deploy blocked on a stale lock file',
            type: 'issue',
            // On the summary since `r-additional-filters`: the bar counts by it.
            requester: 'human',
            state: 'pending',
            decidedOnRevision: null,
            carriedOver: false,
            contentChangedSince: null,
            // On the summary since #103, the same shape `records.listAll` sends.
            lifecycle: { status: 'open', refs: [], note: null, actor: null, at: null },
          },
        ],
      })
    })

    test('reports a carried-over decision as decided, and a changed record as pending', async () => {
      await api.caller.decisions.record({
        retroId,
        rid: 'r-record-1',
        revision: 1,
        state: 'approved',
      })
      await api.caller.decisions.record({
        retroId,
        rid: 'r-record-2',
        revision: 1,
        state: 'approved',
      })
      await api.finishRound(retroId)
      await api.revision(sessionId, [{}, { problem: 'A rewritten problem statement.' }])

      const listed = await api.caller.records.list({ retroId })

      expect(listed.pending).toBe(1)
      expect(listed.records[0]).toMatchObject({
        state: 'approved',
        carriedOver: true,
        decidedOnRevision: 1,
      })
      expect(listed.records[1]).toMatchObject({
        state: 'pending',
        contentChangedSince: 1,
      })
    })

    test('reads an earlier revision when the page pins one', async () => {
      await api.finishRound(retroId)
      await api.revision(sessionId, [{}, {}, {}])

      expect((await api.caller.records.list({ retroId, revision: 1 })).records).toHaveLength(2)
      expect((await api.caller.records.list({ retroId })).records).toHaveLength(3)
    })
  })

  describe('records.get', () => {
    test('returns the narrative, the proposals and the decision', async () => {
      const detail = await api.caller.records.get({ retroId, rid: 'r-record-1' })

      expect(detail.record.rid).toBe('r-record-1')
      expect(detail.record.humanWords[0]?.context).toBe('while watching the deploy log')
      expect(detail.record.proposed).toEqual({
        severity: 3,
        solutionLevel: 2,
        involvement: 'pull-request',
      })
      expect(detail.decision.state).toBe('pending')
      expect(detail.decision.reviewerNote).toBeNull()
    })

    /**
     * A record carries one shape or the other, and the wire says which by
     * nulling the half that is not there rather than omitting keys — a browser
     * that had to tell "not this shape" from "the server forgot" would be
     * branching on absence (views.schema.ts header).
     */
    test('carries a solutions record’s proposals, and nulls the two it replaced', async () => {
      const detail = await api.caller.records.get({ retroId, rid: 'r-record-1' })

      expect(detail.record.agreedDirection).toBeNull()
      expect(detail.record.footprint).toBeNull()
      expect(detail.record.solutions).toEqual(aRecord().solutions)
      // The AI's proposed level is the recommended solution's, so the key goes
      // on meaning what it always meant.
      expect(detail.record.proposed.solutionLevel).toBe(2)
      // Pending, so what shows is the AI's recommendation.
      expect(detail.decision.selectedSolution).toBe(2)
    })

    test('carries a legacy record’s direction and footprint, and nulls solutions', async () => {
      const legacy = await api.legacyRevision(sessionId)

      const detail = await api.caller.records.get({
        retroId: legacy.retroId,
        rid: legacy.record.rid,
      })

      expect(detail.record.agreedDirection).toBe(legacy.record.agreedDirection)
      expect(detail.record.footprint).toBe(legacy.record.footprint)
      expect(detail.record.solutions).toBeNull()
      expect(detail.decision.selectedSolution).toBeNull()
    })

    /**
     * And **not** the record's comments (session 7). They rode here until the
     * owner made the panel the one comments surface — *"Replace inline comments
     * in retro body with comments in the side panel … This enables human to see
     * all comments in one place"* — and a second procedure still answering for
     * them is a second answer to keep in agreement with `threads.list`.
     *
     * Asserted as the absence of the key rather than as an empty array: an empty
     * `threads: []` would be the field still on the wire, saying nothing. The
     * thread opened first is what makes the absence mean something — the record
     * genuinely has a comment, and `threads.list` is where it is found.
     */
    test('does not carry the record’s comments; the panel reads threads.list', async () => {
      const opened = await api.caller.threads.open({
        retroId,
        target: { kind: 'record', rid: 'r-record-1', section: 'problem' },
        text: 'The impact is understated.',
      })

      const detail = await api.caller.records.get({ retroId, rid: 'r-record-1' })

      expect(Object.keys(detail).sort()).toEqual([
        'decision',
        // Beside the narrative, never inside it: `record` is the AI's draft as
        // the revision stores it, and the number is the one name on a record the
        // AI does not author (`record-id.model.ts`).
        'globalId',
        // Likewise, and for the same reason: a label is something a human put on
        // the record afterwards, not a field of the draft (session 10).
        'labels',
        'record',
        'retroId',
        'revision',
      ])
      expect(Object.keys(detail.record)).not.toContain('globalId')
      expect((await api.caller.threads.list({ retroId })).map((thread) => thread.id)).toEqual([
        opened.id,
      ])
    })

    test('is NOT_FOUND for a record that is not in that revision', async () => {
      expect(await codeOf(() => api.caller.records.get({ retroId, rid: 'r-ghost' }))).toBe(
        'NOT_FOUND',
      )
    })

    test('is BAD_REQUEST for a rid that is not a slug', async () => {
      expect(await codeOf(() => api.caller.records.get({ retroId, rid: 'NOT A SLUG' }))).toBe(
        'BAD_REQUEST',
      )
    })
  })

  /**
   * The number every record-carrying answer reports, on a **second**
   * retrospective — the only arrangement in which it and the per-retro `num`
   * differ, and therefore the only one in which a projection sending `num` under
   * the new key can be caught. On the first retrospective of a fresh store the
   * two agree, and every fixture above is that retrospective.
   */
  describe('the global record number, where it parts from num', () => {
    let elsewhere: number

    beforeEach(async () => {
      const session = (
        await api.app.sessions.create.execute({
          actor: 'ai',
          claudeSession: 'uuid-elsewhere',
          cwd: '/Users/haider/Developer/harbor',
          supervised: false,
        })
      ).session.id
      elsewhere = (
        await api.app.revisions.create.execute({
          actor: 'ai',
          session,
          revision: { records: [aRecord({ rid: 'r-record-1', num: 1 })] },
        })
      ).retroId
    })

    test('records.list reports it on every summary in the column', async () => {
      const here = await api.caller.records.list({ retroId })
      const there = await api.caller.records.list({ retroId: elsewhere })

      expect(here.records.map((record) => [record.globalId, record.num])).toEqual([
        [1, 1],
        [2, 2],
      ])
      // Its retrospective's record 1, and the store's record 3.
      expect(there.records.map((record) => [record.globalId, record.num])).toEqual([[3, 1]])
    })

    test('records.get reports it beside the narrative, which does not carry it', async () => {
      const detail = await api.caller.records.get({ retroId: elsewhere, rid: 'r-record-1' })

      expect(detail.globalId).toBe(3)
      expect(detail.record.num).toBe(1)
    })

    test('records.listAll reports the same number the column does', async () => {
      const rows = await api.caller.records.listAll({})

      expect(rows.map((row) => [row.retroId, row.globalId, row.num])).toEqual([
        [elsewhere, 3, 1],
        [retroId, 1, 1],
        [retroId, 2, 2],
      ])
    })

    /**
     * And `records.byId` is the one that reads the number rather than reporting
     * it. Both retrospectives hold an `r-record-1`, which is the arrangement
     * that makes this falsifiable: a resolver keying on the rid, or answering
     * from whichever row it reached first, opens the same record for both
     * numbers.
     */
    test('records.byId opens the record that number names, not the other one', async () => {
      expect((await api.caller.records.byId({ id: 1 })).retroId).toBe(retroId)
      expect((await api.caller.records.byId({ id: 3 })).retroId).toBe(elsewhere)
      expect((await api.caller.records.byId({ id: 3 })).record.num).toBe(1)
      expect((await api.caller.records.byId({ id: 3 })).globalId).toBe(3)
    })
  })

  describe('records.byId', () => {
    /**
     * The whole answer, once. It is `records.get`'s shape plus the five keys a
     * page standing on its own needs, and writing it out here is what makes a
     * sixth key something somebody has to add on purpose.
     */
    test('is the record detail, plus where it came from, plus both axes, relations and the timeline', async () => {
      expect(await api.caller.records.byId({ id: 1 })).toEqual({
        ...(await api.caller.records.get({ retroId, rid: 'r-record-1' })),
        retroNumber: 1,
        session: {
          id: sessionId,
          cwd: '/Users/haider/Developer/retro',
          startedAt: '2026-08-24T09:00:00.000Z',
        },
        // Untouched, so `undefined` on the read model becomes null on the wire —
        // never an absent key (views.schema.ts header).
        lifecycle: { status: 'open', refs: [], note: null, actor: null, at: null },
        // A record nobody has marked up. The populated half is asserted in the
        // labels-and-attributes block below, on this same procedure.
        attributes: [],
        // And nobody has related. The populated half is the `records.relate`
        // block below, which reads this key back from both records' pages.
        relations: [],
        timeline: [{ kind: 'created', at: '2026-08-24T09:00:00.000Z', revision: 1, actor: 'ai' }],
      })
    })

    /**
     * The two procedures answer the same record identically, because one
     * function builds that half of both (`wire.ts` §toWireRecordDetail). A
     * second projection would be a second chance for the record page and the
     * review pane to disagree about what a record is — and both copies would
     * still satisfy `recordDetailSchema`, so nothing but this would catch it.
     */
    test('answers the record exactly as records.get does', async () => {
      const page = await api.caller.records.byId({ id: 2 })
      const pane = await api.caller.records.get({ retroId, rid: 'r-record-2' })

      expect(page.record).toEqual(pane.record)
      expect(page.decision).toEqual(pane.decision)
      expect(page.revision).toBe(pane.revision)
      expect(page.globalId).toBe(pane.globalId)
    })

    test('is NOT_FOUND for a number nothing was minted for', async () => {
      expect(await codeOf(() => api.caller.records.byId({ id: 404 }))).toBe('NOT_FOUND')
    })

    /**
     * The input is a positive integer, so the two shapes a URL can hand it that
     * are not one are refused before any read happens. `/records/0` and
     * `/records/-1` are not requests for a record — the sequence starts at 1.
     */
    test('is BAD_REQUEST for a number that could not be one', async () => {
      expect(await codeOf(() => api.caller.records.byId({ id: 0 }))).toBe('BAD_REQUEST')
      expect(await codeOf(() => api.caller.records.byId({ id: -1 }))).toBe('BAD_REQUEST')
      expect(await codeOf(() => api.caller.records.byId({ id: 1.5 }))).toBe('BAD_REQUEST')
      expect(await codeOf(() => api.caller.records.byId({ id: 'one' } as never))).toBe(
        'BAD_REQUEST',
      )
    })

    /**
     * **The timeline populated, which is the state it spends its life in.** An
     * untouched record's timeline is one `created` line, so a suite that only
     * ever read that one would leave the two kinds that carry the interesting
     * fields — a verdict's revision and state, an act's references, note and
     * author — checked by nothing. Here the record is decided, closed,
     * resolved by the AI and reopened by the human, which is every kind and
     * both authors on one list.
     */
    test('carries every verdict and every lifecycle act, oldest first', async () => {
      api.clock.set('2026-08-24T10:00:00.000Z')
      await api.caller.decisions.record({
        retroId,
        rid: 'r-record-1',
        revision: 1,
        state: 'approved',
      })
      await api.caller.decisions.record({
        retroId,
        rid: 'r-record-2',
        revision: 1,
        state: 'approved',
      })

      api.clock.set('2026-08-24T11:00:00.000Z')
      await api.closeReview(retroId)

      api.clock.set('2026-08-25T09:30:00.000Z')
      await api.app.records.setLifecycle.execute({
        actor: 'ai',
        retro: { retroId },
        rid: 'r-record-1',
        status: 'resolved',
        refs: ['a1b2c3d', 'https://github.com/o/r/pull/42'],
        note: 'Landed on main.',
      })

      api.clock.set('2026-08-26T08:15:00.000Z')
      await api.caller.records.setLifecycle({ retroId, rid: 'r-record-1', status: 'reopened' })

      const page = await api.caller.records.byId({ id: 1 })

      expect(page.timeline).toEqual([
        { kind: 'created', at: '2026-08-24T09:00:00.000Z', revision: 1, actor: 'ai' },
        {
          kind: 'decision',
          at: '2026-08-24T10:00:00.000Z',
          revision: 1,
          state: 'approved',
          actor: 'human',
          version: 1,
        },
        {
          kind: 'lifecycle',
          at: '2026-08-25T09:30:00.000Z',
          status: 'resolved',
          actor: 'ai',
          refs: ['a1b2c3d', 'https://github.com/o/r/pull/42'],
          note: 'Landed on main.',
          version: 1,
        },
        {
          kind: 'lifecycle',
          at: '2026-08-26T08:15:00.000Z',
          status: 'reopened',
          actor: 'human',
          // An act that cites nothing carries an empty list rather than a
          // missing key, and a note nobody wrote is null rather than absent.
          refs: [],
          note: null,
          version: 2,
        },
      ])
      // Where the two axes actually stand, beside the history of how they got
      // there: reopened is an act, and `open` is where it left the record.
      expect(page.lifecycle.status).toBe('open')
      expect(page.decision.state).toBe('approved')
    })

    /**
     * A **declined** record is archived from birth and nobody wrote a row saying
     * so (`record-lifecycle.service.ts`). The wire says both halves of that at
     * once: the status is `archived` with a null author, and the timeline holds
     * the decline as the verdict it was and no lifecycle event at all.
     */
    test('shows a declined record archived, with nothing on the timeline that archived it', async () => {
      api.clock.set('2026-08-24T10:00:00.000Z')
      await api.caller.decisions.record({
        retroId,
        rid: 'r-record-1',
        revision: 1,
        state: 'declined',
      })

      const page = await api.caller.records.byId({ id: 1 })

      expect(page.lifecycle).toEqual({
        status: 'archived',
        refs: [],
        note: null,
        actor: null,
        at: null,
      })
      expect(page.timeline.map((entry) => entry.kind)).toEqual(['created', 'decision'])
    })

    /**
     * The identity line is the record's own retrospective's, counted within its
     * own session (KC-0011) — the same shape `retros.list` and `records.listAll`
     * carry, so the page states the line a dashboard row and a records row
     * already state.
     */
    test('carries the identity line of the retrospective the record belongs to', async () => {
      await api.caller.decisions.record({
        retroId,
        rid: 'r-record-1',
        revision: 1,
        state: 'approved',
      })
      await api.caller.decisions.record({
        retroId,
        rid: 'r-record-2',
        revision: 1,
        state: 'approved',
      })
      await api.closeReview(retroId)
      const second = await api.revision(sessionId)

      const page = await api.caller.records.byId({ id: 3 })

      expect(page.retroId).toBe(second)
      expect(page.retroNumber).toBe(2)
      expect(page.session.cwd).toBe('/Users/haider/Developer/retro')
    })

    /**
     * The latest revision and only that — the revision `records.listAll` lists
     * and `setLifecycle` accepts a rid from, so everything the page shows is
     * something its own controls can act on. A record a later draft withdrew
     * keeps its number and answers NOT_FOUND.
     */
    test('reads the latest draft, and is NOT_FOUND for a record a later one withdrew', async () => {
      await api.finishRound(retroId)
      await api.app.revisions.create.execute({
        actor: 'ai',
        session: sessionId,
        revision: {
          records: [aRecord({ rid: 'r-record-1', num: 1, problem: 'The telling that stands.' })],
        },
      })

      const page = await api.caller.records.byId({ id: 1 })
      expect(page.record.problem).toBe('The telling that stands.')
      expect(page.revision).toBe(2)
      expect(await codeOf(() => api.caller.records.byId({ id: 2 }))).toBe('NOT_FOUND')
    })

    test('carries a legacy record’s direction and footprint, like records.get does', async () => {
      const legacy = await api.legacyRevision(sessionId)
      const minted = await api.store.recordIds.findByRecord(legacy.retroId, legacy.record.rid)

      const page = await api.caller.records.byId({ id: minted?.id ?? 0 })

      expect(page.record.agreedDirection).toBe(legacy.record.agreedDirection)
      expect(page.record.footprint).toBe(legacy.record.footprint)
      expect(page.record.solutions).toBeNull()
    })
  })

  describe('records.listAll', () => {
    /** A second session, so the flat listing has something to cross. */
    const anotherSession = async (cwd: string): Promise<number> =>
      (
        await api.app.sessions.create.execute({
          actor: 'ai',
          claudeSession: 'uuid-2',
          cwd,
          supervised: false,
        })
      ).session.id

    test('returns every record of every retrospective, newest retro first', async () => {
      const elsewhere = await anotherSession('/Users/haider/Developer/harbor')
      const { retroId: elsewhereRetro } = await api.app.revisions.create.execute({
        actor: 'ai',
        session: elsewhere,
        revision: { records: [aRecord({ rid: 'r-record-1', num: 1 })] },
      })

      const rows = await api.caller.records.listAll({})

      expect(rows.map((row) => [row.retroId, row.rid])).toEqual([
        [elsewhereRetro, 'r-record-1'],
        [retroId, 'r-record-1'],
        [retroId, 'r-record-2'],
      ])
      expect(rows.map((row) => row.session.cwd)).toEqual([
        '/Users/haider/Developer/harbor',
        '/Users/haider/Developer/retro',
        '/Users/haider/Developer/retro',
      ])
      /**
       * One sequence over both retrospectives, on the wire — the owner's *"I
       * will like the global sequence rather than this retro prefix."*
       *
       * The pair is the assertion: the newest row is `num` 1 and `globalId` 3,
       * so a projection that sent `num` under the new key sends two rows that
       * contradict each other rather than one that reads plausibly.
       */
      expect(rows.map((row) => [row.globalId, row.num])).toEqual([
        [3, 1],
        [1, 1],
        [2, 2],
      ])
    })

    /**
     * The same rid in two retrospectives is two records (A5), and this is the
     * one page that shows both at once — so it is the page where the number
     * being global rather than per-retro is the difference between two rows a
     * reader can tell apart and two rows that both say "#1".
     */
    test('numbers the same rid in two retrospectives differently', async () => {
      const elsewhere = await anotherSession('/Users/haider/Developer/harbor')
      await api.app.revisions.create.execute({
        actor: 'ai',
        session: elsewhere,
        revision: { records: [aRecord({ rid: 'r-record-1', num: 1 })] },
      })

      const sameRid = (await api.caller.records.listAll({})).filter(
        (row) => row.rid === 'r-record-1',
      )

      expect(sameRid.map((row) => row.num)).toEqual([1, 1])
      expect(sameRid.map((row) => row.globalId)).toEqual([3, 1])
    })

    /** The whole row, once — an added field has to be written down before it ships. */
    test('carries the identity line, the record and both axes of state', async () => {
      expect((await api.caller.records.listAll({}))[0]).toEqual({
        retroId,
        retroNumber: 1,
        session: {
          id: sessionId,
          cwd: '/Users/haider/Developer/retro',
          startedAt: '2026-08-24T09:00:00.000Z',
        },
        rid: 'r-record-1',
        globalId: 1,
        num: 1,
        title: 'Deploy blocked on a stale lock file',
        type: 'issue',
        requester: 'human',
        state: 'pending',
        severity: 3,
        proposedLevel: 2,
        // Untouched, so `undefined` on the read model becomes null on the wire —
        // never an absent key (views.schema.ts header).
        lifecycle: { status: 'open', refs: [], note: null, actor: null, at: null },
        // On the row since the dashboard's "Require human" tile
        // needed a count over every open record. Effective, so this is the AI's
        // proposal while the record is pending — the harness fixture proposes
        // `pull-request`.
        involvement: 'pull-request',
        labels: [],
      })
    })

    test('reports the verdict in effect, not the one that was stored', async () => {
      await api.caller.decisions.record({
        retroId,
        rid: 'r-record-1',
        revision: 1,
        state: 'approved',
        severity: 5,
      })

      expect(
        (await api.caller.records.listAll({})).map((row) => [row.state, row.severity]),
      ).toEqual([
        ['approved', 5],
        ['pending', 3],
      ])
    })

    /**
     * Both record shapes in one listing. A legacy record has a level its draft
     * authored; a solutions record's is the recommended solution's, and
     * `proposedLevel()` is the one function that answers either.
     */
    test('reads the proposed level of a legacy record and a solutions record alike', async () => {
      const legacy = await api.legacyRevision(sessionId)

      const rows = await api.caller.records.listAll({})

      expect(rows.map((row) => [row.rid, row.proposedLevel])).toEqual([
        [legacy.record.rid, 2],
        ['r-record-1', 2],
        ['r-record-2', 2],
      ])
    })

    test('is an empty list before anything has been retrospected', async () => {
      expect(await createApiHarness().caller.records.listAll({})).toEqual([])
    })

    test('is BAD_REQUEST when the input carries anything at all', async () => {
      expect(await codeOf(() => api.caller.records.listAll({ retroId } as never))).toBe(
        'BAD_REQUEST',
      )
    })
  })

  describe('records.setLifecycle', () => {
    test('resolves a record with its references and returns where that leaves it', async () => {
      const result = await api.caller.records.setLifecycle({
        retroId,
        rid: 'r-record-1',
        status: 'resolved',
        refs: ['a1b2c3d', 'https://github.com/o/r/pull/42'],
        note: 'Landed on main.',
      })

      expect(result).toEqual({
        retroId,
        rid: 'r-record-1',
        version: 1,
        lifecycle: {
          status: 'resolved',
          refs: ['a1b2c3d', 'https://github.com/o/r/pull/42'],
          note: 'Landed on main.',
          actor: 'human',
          at: '2026-08-24T09:00:00.000Z',
        },
      })
    })

    /**
     * **The browser is always the human**, because the context pins that actor
     * unconditionally and takes no request argument to negotiate it
     * (`context.ts`). There is nothing for this procedure to refuse: the AI
     * cannot reach it to be refused, which is a stronger guarantee than a check
     * would be. That the *use case* accepts both actors — the deliberate
     * relaxation this feature makes — is proved in the core's own suite, below
     * every adapter, which is where an actor rule belongs.
     */
    test('records the human as the author, whatever else is on the wire', async () => {
      await api.caller.records.setLifecycle({
        retroId,
        rid: 'r-record-1',
        status: 'resolved',
        refs: ['a1b2c3d'],
      })

      expect((await api.caller.records.listAll({}))[0]?.lifecycle.actor).toBe('human')
    })

    test('reopening appends a version and the listing follows', async () => {
      await api.caller.records.setLifecycle({
        retroId,
        rid: 'r-record-1',
        status: 'resolved',
        refs: ['a1b2c3d'],
      })
      expect((await api.caller.records.listAll({}))[0]?.lifecycle.status).toBe('resolved')

      const reopened = await api.caller.records.setLifecycle({
        retroId,
        rid: 'r-record-1',
        status: 'reopened',
      })

      expect(reopened.version).toBe(2)
      expect((await api.caller.records.listAll({}))[0]?.lifecycle).toEqual({
        status: 'open',
        refs: [],
        note: null,
        actor: 'human',
        at: '2026-08-24T09:00:00.000Z',
      })
    })

    /**
     * **Still reachable on a finished retrospective**, and it is the only write
     * on this router that is. The owner asked for it because the retro is
     * closed; `review.test.ts` in core names it beside the enumeration of every
     * write that refuses.
     */
    test('is not closed by the review closing', async () => {
      for (const rid of ['r-record-1', 'r-record-2']) {
        await api.caller.decisions.record({ retroId, rid, revision: 1, state: 'approved' })
      }
      await api.closeReview(retroId)

      expect(
        (
          await api.caller.records.setLifecycle({
            retroId,
            rid: 'r-record-1',
            status: 'resolved',
            refs: ['a1b2c3d'],
          })
        ).lifecycle.status,
      ).toBe('resolved')
    })

    test('is NOT_FOUND for an unknown retrospective or an unknown record', async () => {
      expect(
        await codeOf(() =>
          api.caller.records.setLifecycle({
            retroId: 404,
            rid: 'r-record-1',
            status: 'resolved',
            refs: ['a1b2c3d'],
          }),
        ),
      ).toBe('NOT_FOUND')
      expect(
        await codeOf(() =>
          api.caller.records.setLifecycle({
            retroId,
            rid: 'r-ghost',
            status: 'resolved',
            refs: ['a1b2c3d'],
          }),
        ),
      ).toBe('NOT_FOUND')
    })

    /**
     * The pairing rule is the domain's and the mapping is this layer's: a
     * `ValidationError` becomes BAD_REQUEST wherever it was raised, so the
     * router does not have to restate which pairings are legal.
     */
    test('is BAD_REQUEST for a resolve citing nothing, or a reopen citing something', async () => {
      expect(
        await codeOf(() =>
          api.caller.records.setLifecycle({ retroId, rid: 'r-record-1', status: 'resolved' }),
        ),
      ).toBe('BAD_REQUEST')
      expect(
        await codeOf(() =>
          api.caller.records.setLifecycle({
            retroId,
            rid: 'r-record-1',
            status: 'resolved',
            refs: [],
          }),
        ),
      ).toBe('BAD_REQUEST')
      expect(
        await codeOf(() =>
          api.caller.records.setLifecycle({
            retroId,
            rid: 'r-record-1',
            status: 'reopened',
            refs: ['a1b2c3d'],
          }),
        ),
      ).toBe('BAD_REQUEST')
    })

    test('is BAD_REQUEST for a status nothing offers', async () => {
      expect(
        await codeOf(() =>
          api.caller.records.setLifecycle({
            retroId,
            rid: 'r-record-1',
            status: 'open' as never,
            refs: ['a1b2c3d'],
          }),
        ),
      ).toBe('BAD_REQUEST')
    })

    /** Nothing to take back is a refusal, not a quiet success (KC-0010). */
    test('is CONFLICT reopening a record that was never resolved', async () => {
      expect(
        await codeOf(() =>
          api.caller.records.setLifecycle({ retroId, rid: 'r-record-1', status: 'reopened' }),
        ),
      ).toBe('CONFLICT')
    })

    /**
     * The owner's session-9 pair, on the wire: *"maybe we can have a type called
     * archived … and the user should be able to unarchive."*
     */
    test('archives a record and the listing follows, citing nothing', async () => {
      const archived = await api.caller.records.setLifecycle({
        retroId,
        rid: 'r-record-1',
        status: 'archived',
        note: 'Superseded by the rewrite.',
      })

      expect(archived).toEqual({
        retroId,
        rid: 'r-record-1',
        version: 1,
        lifecycle: {
          status: 'archived',
          refs: [],
          note: 'Superseded by the rewrite.',
          actor: 'human',
          at: '2026-08-24T09:00:00.000Z',
        },
      })
      expect((await api.caller.records.listAll({}))[0]?.lifecycle.status).toBe('archived')
    })

    test('unarchiving puts the record back where it was owed', async () => {
      await api.caller.records.setLifecycle({ retroId, rid: 'r-record-1', status: 'archived' })

      const back = await api.caller.records.setLifecycle({
        retroId,
        rid: 'r-record-1',
        status: 'unarchived',
      })

      expect(back.version).toBe(2)
      expect((await api.caller.records.listAll({}))[0]?.lifecycle.status).toBe('open')
    })

    /**
     * **A declined record is archived with no row anywhere** — the derivation,
     * seen from the wire. Nothing was written at the close, so `actor` and `at`
     * are null on a row the page nonetheless renders as archived: what put it
     * there is the verdict beside it, which is the field above.
     */
    test('reports a declined record as archived without an entry behind it', async () => {
      await api.caller.decisions.record({
        retroId,
        rid: 'r-record-1',
        revision: 1,
        state: 'declined',
      })

      expect((await api.caller.records.listAll({}))[0]?.lifecycle).toEqual({
        status: 'archived',
        refs: [],
        note: null,
        actor: null,
        at: null,
      })
    })

    test('unarchiving a record born archived writes its first version', async () => {
      await api.caller.decisions.record({
        retroId,
        rid: 'r-record-1',
        revision: 1,
        state: 'declined',
      })

      const back = await api.caller.records.setLifecycle({
        retroId,
        rid: 'r-record-1',
        status: 'unarchived',
      })

      expect(back.version).toBe(1)
      expect((await api.caller.records.listAll({}))[0]?.lifecycle.status).toBe('open')
    })

    /**
     * Transitions are the domain's and the mapping is this layer's: an act taken
     * from a state that does not permit it is a `ConflictError` wherever it was
     * raised, so the router does not restate the table.
     */
    test('is CONFLICT for an act the record’s state does not permit', async () => {
      expect(
        await codeOf(() =>
          api.caller.records.setLifecycle({ retroId, rid: 'r-record-1', status: 'unarchived' }),
        ),
      ).toBe('CONFLICT')

      await api.caller.records.setLifecycle({ retroId, rid: 'r-record-1', status: 'archived' })

      for (const status of ['archived', 'reopened'] as const) {
        expect(
          await codeOf(() =>
            api.caller.records.setLifecycle({ retroId, rid: 'r-record-1', status }),
          ),
        ).toBe('CONFLICT')
      }
      expect(
        await codeOf(() =>
          api.caller.records.setLifecycle({
            retroId,
            rid: 'r-record-1',
            status: 'resolved',
            refs: ['a1b2c3d'],
          }),
        ),
      ).toBe('CONFLICT')
    })

    test('is BAD_REQUEST for an archive citing a reference', async () => {
      expect(
        await codeOf(() =>
          api.caller.records.setLifecycle({
            retroId,
            rid: 'r-record-1',
            status: 'archived',
            refs: ['a1b2c3d'],
          }),
        ),
      ).toBe('BAD_REQUEST')
    })

    /**
     * The event reaches the retro's stream, which is what gives the records page
     * live updates through the invalidation map the review page already uses.
     */
    test('announces the act on the retrospective’s event stream', async () => {
      await api.caller.records.setLifecycle({
        retroId,
        rid: 'r-record-1',
        status: 'resolved',
        refs: ['a1b2c3d'],
      })
      await api.caller.records.setLifecycle({ retroId, rid: 'r-record-1', status: 'reopened' })
      // Both halves of the second pair, so the four acts are four names — a
      // consumer watching for "somebody put this out of the way" reads the name
      // rather than unpacking a payload.
      await api.caller.records.setLifecycle({ retroId, rid: 'r-record-1', status: 'archived' })
      await api.caller.records.setLifecycle({ retroId, rid: 'r-record-1', status: 'unarchived' })

      const { events } = await api.app.events.list.execute({ actor: 'human', retro: { retroId } })

      expect(
        events
          .filter((event) => event.name.startsWith('Record'))
          .map((event) => [event.name, event.rid]),
      ).toEqual([
        ['RecordResolved', 'r-record-1'],
        ['RecordReopened', 'r-record-1'],
        ['RecordArchived', 'r-record-1'],
        ['RecordUnarchived', 'r-record-1'],
      ])
    })
  })

  /**
   * **`records.relate`** (the owner's session-11 ask) — the one write on this
   * wire that names **two** records, and it names them by the global number
   * because a relation crosses retrospectives and the pair that addresses one
   * record is not a handle for two.
   *
   * What a transport suite can prove is what a transport does: the numbers and
   * the words cross, both records' pages answer from the one stored row, and
   * each refusal arrives with the right code. Who may write one is not a
   * question this file can ask — the context pins `human` unconditionally and
   * both actors may relate anyway, so the actor half is proved where it lives
   * (`packages/core/test/unit/record-relations.test.ts`).
   */
  describe('records.relate', () => {
    /** `beforeEach` files two records; the global sequence numbers them 1 and 2. */
    const FIRST = 1
    const SECOND = 2
    /** A record of a *second* retrospective, so a relation has somewhere to cross to. */
    const ELSEWHERE = 3

    /**
     * The order the block below reads, and the reason it is worth pinning: the
     * relations in force are sorted by **the id of the row in force**, so an act
     * on an old pair moves that pair to the end. It is the one ordering rule a
     * reader of two surfaces can catch the mock getting wrong (`relation.view.ts`
     * §relationsInForce), and it is invisible to both the output schema and the
     * parity check — an array of the right shape in the wrong order satisfies
     * `z.array(...)` exactly as well as one in the right order.
     */
    const relationsOn = async (id: number) =>
      (await api.caller.records.byId({ id })).relations.map((relation) => [
        relation.globalId,
        relation.direction,
      ])

    /**
     * A second retrospective, of a second session — because the relation this
     * feature exists for is the one that crosses them, and because the number
     * `ELSEWHERE` names is only real if something minted it.
     */
    beforeEach(async () => {
      await api.revision(await api.session('uuid-relate-elsewhere'))
    })

    test('relates two records, and both pages answer from the one row', async () => {
      const written = await api.caller.records.relate({
        fromId: FIRST,
        toId: SECOND,
        related: true,
        how: 'supersedes',
      })

      expect(written).toEqual({
        fromId: FIRST,
        toId: SECOND,
        version: 1,
        // No `title` on a write's answer — naming the far end costs a read of
        // its retrospective, and the page re-reads for that (views.schema.ts).
        relations: [
          {
            globalId: SECOND,
            how: 'supersedes',
            direction: 'outgoing',
            actor: 'human',
            at: '2026-08-24T09:00:00.000Z',
          },
        ],
      })

      expect((await api.caller.records.byId({ id: FIRST })).relations).toEqual([
        {
          globalId: SECOND,
          title: 'Deploy blocked on a stale lock file',
          how: 'supersedes',
          direction: 'outgoing',
          actor: 'human',
          at: '2026-08-24T09:00:00.000Z',
        },
      ])
      expect(
        (await api.caller.records.byId({ id: SECOND })).relations.map((relation) => [
          relation.globalId,
          relation.direction,
        ]),
      ).toEqual([[FIRST, 'incoming']])
    })

    test('un-relating takes the line off both pages and answers with what is left', async () => {
      await api.caller.records.relate({
        fromId: FIRST,
        toId: SECOND,
        related: true,
        how: 'supersedes',
      })
      const removed = await api.caller.records.relate({
        fromId: FIRST,
        toId: SECOND,
        related: false,
      })

      expect(removed).toMatchObject({ version: 2, relations: [] })
      expect((await api.caller.records.byId({ id: FIRST })).relations).toEqual([])
      expect((await api.caller.records.byId({ id: SECOND })).relations).toEqual([])
    })

    test('maps each refusal to the code the middleware owns', async () => {
      expect(
        await codeOf(() =>
          api.caller.records.relate({ fromId: FIRST, toId: FIRST, related: true, how: 'itself' }),
        ),
      ).toBe('BAD_REQUEST')
      expect(
        await codeOf(() =>
          api.caller.records.relate({ fromId: FIRST, toId: 404, related: true, how: 'nowhere' }),
        ),
      ).toBe('NOT_FOUND')
      // The words are half the act, so a relate without them is refused at the
      // boundary rather than written as an empty string.
      expect(
        await codeOf(() =>
          api.caller.records.relate({ fromId: FIRST, toId: SECOND, related: true }),
        ),
      ).toBe('BAD_REQUEST')
      expect(
        await codeOf(() =>
          api.caller.records.relate({ fromId: FIRST, toId: SECOND, related: false }),
        ),
      ).toBe('CONFLICT')
    })

    /**
     * **Free text travels verbatim** (`text.schema.ts`): the schema refines on a
     * trimmed value and transforms nothing, so what the author typed is what the
     * row holds. Pinned here because it is the contract the browser's typed mock
     * has to match, and a mock that trimmed would be answering a question this
     * wire does not ask.
     */
    test('keeps the words exactly as they were written', async () => {
      const written = await api.caller.records.relate({
        fromId: FIRST,
        toId: SECOND,
        related: true,
        how: '  supersedes  ',
      })

      expect(written.relations[0]?.how).toBe('  supersedes  ')
      expect((await api.caller.records.byId({ id: FIRST })).relations[0]?.how).toBe(
        '  supersedes  ',
      )
    })

    /**
     * **The relations in force are ordered by the row in force, not by when the
     * pair was first written** — so re-relating an old pair moves it to the end.
     *
     * The arrangement is the one that makes the two orderings disagree: the
     * cross-retro pair is written **first**, so first-written order says
     * `[#3, #2]` for the whole scenario, and row-in-force order says `[#3, #2]`
     * until the old pair is re-related and `[#2, #3]` afterwards. A projection
     * that folded into a map and handed back its insertion order would pass every
     * assertion in this file except the second half of this one.
     */
    test('orders relations by the row in force, so a re-related pair moves to the end', async () => {
      await api.caller.records.relate({
        fromId: ELSEWHERE,
        toId: FIRST,
        related: true,
        how: 'the same lock, three retros later',
      })
      await api.caller.records.relate({
        fromId: FIRST,
        toId: SECOND,
        related: true,
        how: 'and this one came after',
      })

      expect(await relationsOn(FIRST)).toEqual([
        [ELSEWHERE, 'incoming'],
        [SECOND, 'outgoing'],
      ])

      await api.caller.records.relate({ fromId: ELSEWHERE, toId: FIRST, related: false })
      await api.caller.records.relate({
        fromId: ELSEWHERE,
        toId: FIRST,
        related: true,
        how: 'and it turned out to be the same one after all',
      })

      expect(await relationsOn(FIRST)).toEqual([
        [SECOND, 'outgoing'],
        [ELSEWHERE, 'incoming'],
      ])
    })

    test('appends a name per act, scoped to the record the act was taken from', async () => {
      await api.caller.records.relate({
        fromId: FIRST,
        toId: SECOND,
        related: true,
        how: 'supersedes',
      })
      await api.caller.records.relate({ fromId: FIRST, toId: SECOND, related: false })

      const { events } = await api.app.events.list.execute({ actor: 'human', retro: { retroId } })

      expect(
        events
          .filter(
            (event) => event.name.startsWith('RecordRelat') || event.name === 'RecordUnrelated',
          )
          .map((event) => [event.name, event.rid]),
      ).toEqual([
        ['RecordRelated', 'r-record-1'],
        ['RecordUnrelated', 'r-record-1'],
      ])
    })
  })

  /**
   * **The labels, the attributes and the toggle** (session 10) — the twelve
   * procedures the owner's two rulings bought.
   *
   * What this file can prove about them is what a *transport* can prove: the
   * shapes cross correctly, the error map answers each refusal with the right
   * code, and the browser is the human. What it deliberately does not try to
   * prove is the guarantee: *"if it is disabled, the user can be certain that
   * the AI cannot mess around"* is enforced below every adapter and is asserted
   * there, in `packages/core/test/unit/settings.test.ts`, because the context
   * here pins `human` unconditionally and there is no payload a browser can send
   * that would reach the guard at all (`context.ts`).
   *
   * **No id is a literal anywhere below.** The harness runs on the memory store,
   * whose `IdGen` is one counter across every table, where SQLite gives each
   * table its own AUTOINCREMENT — so a definition's id is 7 here and 1 there,
   * and both are right. Every assertion takes the id from the answer that minted
   * it, which is also what the fixture in `trpc-mock.ts` does and for the same
   * reason.
   */
  describe('labels, attributes and the settings toggle', () => {
    /** Creates a label and hands back its id — see the block header on why. */
    const defineLabel = async (name: string): Promise<number> =>
      (await api.caller.labels.define({ name })).id

    const defineAttribute = async (
      name: string,
      type: 'number' | 'text' | 'url' | 'date',
    ): Promise<number> => (await api.caller.attributes.define({ name, type })).id

    describe('the vocabularies', () => {
      /**
       * **A fresh store ships none.** *"To keep it flexible we will not hardcode
       * any labels or attributes"* — so the first thing this surface says about
       * itself is that it says nothing, and `migrated` is not there.
       */
      test('are empty until somebody creates one', async () => {
        expect(await api.caller.labels.list({})).toEqual([])
        expect(await api.caller.attributes.list({})).toEqual([])
      })

      test('define answers with the whole definition, once', async () => {
        const label = await api.caller.labels.define({ name: '  migrated  ' })

        expect(label).toEqual({
          id: label.id,
          // Trimmed, which is the second field in this system that is: a name is
          // a token somebody typed into a field, not prose.
          name: 'migrated',
          retiredAt: null,
          createdAt: '2026-08-24T09:00:00.000Z',
        })

        const attribute = await api.caller.attributes.define({
          name: 'external issue id',
          type: 'url',
        })

        expect(attribute).toEqual({
          id: attribute.id,
          name: 'external issue id',
          type: 'url',
          retiredAt: null,
          createdAt: '2026-08-24T09:00:00.000Z',
        })
      })

      /** Retired entries stay on the list: three readers want three subsets of one answer. */
      test('list every definition in minting order, retired ones included', async () => {
        const migrated = await defineLabel('migrated')
        await defineLabel('needs triage')
        await api.caller.labels.retire({ id: migrated })

        expect((await api.caller.labels.list({})).map((one) => [one.name, one.retiredAt])).toEqual([
          ['migrated', '2026-08-24T09:00:00.000Z'],
          ['needs triage', null],
        ])
      })

      test('rename and retire answer with the row the store now holds', async () => {
        const id = await defineLabel('migratd')

        expect(await api.caller.labels.rename({ id, name: 'migrated' })).toMatchObject({
          id,
          name: 'migrated',
          retiredAt: null,
        })
        expect(await api.caller.labels.retire({ id })).toMatchObject({
          name: 'migrated',
          retiredAt: '2026-08-24T09:00:00.000Z',
        })
      })

      /** The rule is the domain's, case-insensitive and including retired names. */
      test('is CONFLICT for a name another definition already holds', async () => {
        await defineLabel('migrated')

        expect(await codeOf(() => api.caller.labels.define({ name: 'MIGRATED' }))).toBe('CONFLICT')
      })

      test('is BAD_REQUEST for a name the domain refuses', async () => {
        for (const name of ['', '   ', 'x'.repeat(41), 'two\nlines']) {
          expect(await codeOf(() => api.caller.labels.define({ name })), name).toBe('BAD_REQUEST')
        }
      })

      test('is BAD_REQUEST for an attribute type nothing offers', async () => {
        expect(
          await codeOf(() =>
            api.caller.attributes.define({ name: 'flagged', type: 'boolean' as never }),
          ),
        ).toBe('BAD_REQUEST')
      })

      test('is NOT_FOUND for a definition nothing answers to', async () => {
        expect(await codeOf(() => api.caller.labels.retire({ id: 404 }))).toBe('NOT_FOUND')
        expect(await codeOf(() => api.caller.attributes.rename({ id: 404, name: 'x' }))).toBe(
          'NOT_FOUND',
        )
      })

      test('is CONFLICT retiring what is already retired', async () => {
        const id = await defineLabel('migrated')
        await api.caller.labels.retire({ id })

        expect(await codeOf(() => api.caller.labels.retire({ id }))).toBe('CONFLICT')
      })

      /**
       * **Un-retire, over the wire** — retro-11 `r-retire-burns-a-word`, his
       * selected solution: retiring was one press with no confirmation and no
       * way back, and the store never frees a retired name, so a mis-press
       * burned a word out of the vocabulary permanently.
       *
       * The answer is the *same row* rather than merely an offerable one — the
       * id the browser is holding is the id every record wears — and the
       * `retiredAt` that comes back is `null`, which is what this wire says for
       * "still offered" everywhere else.
       */
      test('un-retire brings the same definition back, on both vocabularies', async () => {
        const labelId = await defineLabel('migrated')
        await api.caller.labels.retire({ id: labelId })

        expect(await api.caller.labels.unretire({ id: labelId })).toEqual({
          id: labelId,
          name: 'migrated',
          retiredAt: null,
          createdAt: '2026-08-24T09:00:00.000Z',
        })

        const attributeId = await defineAttribute('story points', 'number')
        await api.caller.attributes.retire({ id: attributeId })

        expect(await api.caller.attributes.unretire({ id: attributeId })).toEqual({
          id: attributeId,
          name: 'story points',
          // The type is untouched by the round trip, which is what makes an
          // un-retire safe where a retype would not be.
          type: 'number',
          retiredAt: null,
          createdAt: '2026-08-24T09:00:00.000Z',
        })
      })

      /** Absorbing it would answer "done" to an act that did nothing. */
      test('is CONFLICT un-retiring what is not retired', async () => {
        const id = await defineLabel('migrated')

        expect(await codeOf(() => api.caller.labels.unretire({ id }))).toBe('CONFLICT')

        await api.caller.labels.retire({ id })
        await api.caller.labels.unretire({ id })
        expect(await codeOf(() => api.caller.labels.unretire({ id }))).toBe('CONFLICT')
      })

      test('is NOT_FOUND un-retiring a definition nothing answers to', async () => {
        expect(await codeOf(() => api.caller.labels.unretire({ id: 404 }))).toBe('NOT_FOUND')
        expect(await codeOf(() => api.caller.attributes.unretire({ id: 404 }))).toBe('NOT_FOUND')
      })

      /**
       * The point of the act, from a record's side: a label refused as retired
       * is accepted again once it comes back, and it is the same definition, so
       * the record's own version sequence for it is one sequence.
       */
      test('a label that was retired can be applied again once it is un-retired', async () => {
        const labelId = await defineLabel('migrated')
        await api.caller.labels.retire({ id: labelId })

        expect(
          await codeOf(() =>
            api.caller.labels.set({ retroId, rid: 'r-record-1', labelId, applied: true }),
          ),
        ).toBe('CONFLICT')

        await api.caller.labels.unretire({ id: labelId })

        expect(
          await api.caller.labels.set({ retroId, rid: 'r-record-1', labelId, applied: true }),
        ).toMatchObject({
          labels: [{ id: labelId, name: 'migrated', retired: false }],
        })
      })

      /**
       * **There is no `retype`, and its absence is the assertion.** Every value
       * already stored was accepted under the type the row carries, so changing
       * it would leave the definition claiming something its own values do not
       * satisfy — the input shape is what makes that unreachable.
       */
      test('rename carries no type, so an attribute’s type cannot be changed over the wire', async () => {
        const id = await defineAttribute('ticket', 'number')

        expect(
          await codeOf(() =>
            api.caller.attributes.rename({ id, name: 'issue', type: 'url' } as never),
          ),
        ).toBe('BAD_REQUEST')
        expect((await api.caller.attributes.list({}))[0]?.type).toBe('number')
      })
    })

    describe('a label on a record', () => {
      let labelId: number

      beforeEach(async () => {
        labelId = await defineLabel('migrated')
      })

      const wear = (applied: boolean, rid = 'r-record-1') =>
        api.caller.labels.set({ retroId, rid, labelId, applied })

      test('goes on and comes off, and the answer says what the record wears now', async () => {
        expect(await wear(true)).toEqual({
          retroId,
          rid: 'r-record-1',
          version: 1,
          // Resolved against the vocabulary rather than sent as an id: the
          // answer is what the next read would give, not a half of it.
          labels: [{ id: labelId, name: 'migrated', retired: false }],
        })

        expect(await wear(false)).toEqual({
          retroId,
          rid: 'r-record-1',
          version: 2,
          labels: [],
        })
      })

      /** The three surfaces a label reaches, all answering from the same join. */
      test('shows on the record’s detail, its page and the flat listing alike', async () => {
        await wear(true)

        const worn = [{ id: labelId, name: 'migrated', retired: false }]
        expect((await api.caller.records.get({ retroId, rid: 'r-record-1' })).labels).toEqual(worn)
        expect((await api.caller.records.byId({ id: 1 })).labels).toEqual(worn)
        expect((await api.caller.records.listAll({})).map((row) => row.labels)).toEqual([worn, []])
      })

      /**
       * A rename writes over the definition, so **every record wearing it reads
       * the new name at once** — which is what makes a definition configuration
       * rather than human data, seen from the wire.
       */
      test('reads the new name everywhere the moment the definition is renamed', async () => {
        await wear(true)

        await api.caller.labels.rename({ id: labelId, name: 'moved to github' })

        expect((await api.caller.records.byId({ id: 1 })).labels).toEqual([
          { id: labelId, name: 'moved to github', retired: false },
        ])
      })

      /** Retiring stops the offering, not the rendering — so the tag stays, marked. */
      test('keeps rendering a retired label, and says it is retired', async () => {
        await wear(true)

        await api.caller.labels.retire({ id: labelId })

        expect((await api.caller.records.byId({ id: 1 })).labels).toEqual([
          { id: labelId, name: 'migrated', retired: true },
        ])
      })

      test('is CONFLICT applying a retired label, and still lets it be removed', async () => {
        await wear(true)
        await api.caller.labels.retire({ id: labelId })

        await wear(false)
        expect(await codeOf(() => wear(true))).toBe('CONFLICT')
      })

      /** A no-op is refused, not absorbed (KC-0010, and `LIFECYCLE_ACT_FROM`'s standing). */
      test('is CONFLICT for an act that would change nothing', async () => {
        expect(await codeOf(() => wear(false))).toBe('CONFLICT')
      })

      test('is NOT_FOUND for an unknown record or an unknown label', async () => {
        expect(await codeOf(() => wear(true, 'r-ghost'))).toBe('NOT_FOUND')
        expect(
          await codeOf(() =>
            api.caller.labels.set({ retroId, rid: 'r-record-1', labelId: 404, applied: true }),
          ),
        ).toBe('NOT_FOUND')
      })

      /**
       * **Still reachable on a finished retrospective**, which is the owner's
       * second usage archetype rather than an oversight: the migrate story
       * happens after the close. It joins `records.setLifecycle` as one of the
       * writes on this router the finish lock deliberately does not guard.
       */
      test('is not closed by the review closing', async () => {
        for (const rid of ['r-record-1', 'r-record-2']) {
          await api.caller.decisions.record({ retroId, rid, revision: 1, state: 'approved' })
        }
        await api.closeReview(retroId)

        expect((await wear(true)).labels).toHaveLength(1)
      })

      test('announces the act on the retrospective’s event stream', async () => {
        await wear(true)
        await wear(false)

        const { events } = await api.app.events.list.execute({ actor: 'human', retro: { retroId } })

        expect(
          events
            .filter((event) => event.name.startsWith('RecordLabel'))
            .map((event) => [event.name, event.rid]),
        ).toEqual([
          ['RecordLabelApplied', 'r-record-1'],
          ['RecordLabelRemoved', 'r-record-1'],
        ])
      })
    })

    describe('a value on a record', () => {
      let attributeId: number

      beforeEach(async () => {
        attributeId = await defineAttribute('external issue id', 'url')
      })

      const carry = (value?: string, rid = 'r-record-1') =>
        api.caller.attributes.set({
          retroId,
          rid,
          attributeId,
          ...(value === undefined ? {} : { value }),
        })

      test('is set and cleared, and the answer says what the record carries now', async () => {
        expect(await carry('https://github.com/o/r/issues/91')).toEqual({
          retroId,
          rid: 'r-record-1',
          version: 1,
          values: [
            {
              id: attributeId,
              name: 'external issue id',
              type: 'url',
              value: 'https://github.com/o/r/issues/91',
              retired: false,
            },
          ],
        })

        // The one input on this wire whose **absence** is an act rather than
        // silence: the caller is saying "take it off".
        expect(await carry()).toEqual({
          retroId,
          rid: 'r-record-1',
          version: 2,
          values: [],
        })
      })

      /**
       * **The record's own page and no other.** A value is data about a record
       * and is something you go and look at; a label is a classification worth a
       * tag wherever the record is listed. So `records.byId` carries these and
       * `records.get` does not — which is a key set, not a nullable field.
       */
      test('rides on the record page and on nothing else', async () => {
        await carry('https://github.com/o/r/issues/91')

        expect((await api.caller.records.byId({ id: 1 })).attributes).toHaveLength(1)
        expect(
          Object.keys(await api.caller.records.get({ retroId, rid: 'r-record-1' })),
        ).not.toContain('attributes')
        expect(Object.keys((await api.caller.records.listAll({}))[0] ?? {})).not.toContain(
          'attributes',
        )
      })

      test('is BAD_REQUEST for a value the definition’s type refuses', async () => {
        expect(await codeOf(() => carry('github.com/o/r/issues/91'))).toBe('BAD_REQUEST')
      })

      /** Re-asserting a value is allowed; clearing what is not there is not. */
      test('takes the same value again, and is CONFLICT clearing nothing', async () => {
        await carry('https://github.com/o/r/issues/91')

        expect((await carry('https://github.com/o/r/issues/91')).version).toBe(2)
        expect(await codeOf(() => carry(undefined, 'r-record-2'))).toBe('CONFLICT')
      })
    })

    describe('the AI-config-write toggle', () => {
      /**
       * **Off is what a fresh install is**, and no row says so — which is what
       * makes the safe state the state a store is born in
       * (`config-write.service.ts`).
       */
      test('is off before anybody touches it', async () => {
        expect(await api.caller.settings.get({})).toEqual({ aiConfigWrite: false })
      })

      test('moves both ways, and the read follows', async () => {
        expect(await api.caller.settings.setAiConfigWrite({ enabled: true })).toEqual({
          aiConfigWrite: true,
        })
        expect(await api.caller.settings.get({})).toEqual({ aiConfigWrite: true })

        await api.caller.settings.setAiConfigWrite({ enabled: false })
        expect(await api.caller.settings.get({})).toEqual({ aiConfigWrite: false })
      })

      /**
       * **The browser is always the human**, so this procedure has nothing to
       * refuse — and that is a stronger guarantee than a check would be: the AI
       * cannot reach it to be refused. That the *use case* refuses the AI
       * forever, whatever the switch currently says, is proved in the core's own
       * suite, below every adapter, which is where an actor rule belongs.
       */
      test('records the human as the writer, and the AI cannot reach this transport', async () => {
        await api.caller.settings.setAiConfigWrite({ enabled: true })

        await expect(
          api.app.settings.setAiConfigWrite.execute({ actor: 'ai', enabled: false }),
        ).rejects.toThrow(/human actor/)
        expect(await api.caller.settings.get({})).toEqual({ aiConfigWrite: true })
      })

      test('is BAD_REQUEST without a value — nothing is granted by omission', async () => {
        expect(await codeOf(() => api.caller.settings.setAiConfigWrite({} as never))).toBe(
          'BAD_REQUEST',
        )
      })
    })
  })

  describe('decisions.record', () => {
    test('records the verdict and returns the effective decision', async () => {
      const result = await api.caller.decisions.record({
        retroId,
        rid: 'r-record-1',
        revision: 1,
        state: 'approved',
        severity: 2,
        reviewerNote: 'Do this one first.',
      })

      expect(result).toEqual({
        rid: 'r-record-1',
        version: 1,
        decision: {
          state: 'approved',
          decidedOnRevision: 1,
          carriedOver: false,
          contentChangedSince: null,
          severity: 2,
          solutionLevel: 2,
          selectedSolution: 2,
          involvement: 'pull-request',
          reviewerNote: 'Do this one first.',
        },
      })
    })

    test('appends a version rather than editing the last one', async () => {
      await api.caller.decisions.record({
        retroId,
        rid: 'r-record-1',
        revision: 1,
        state: 'declined',
      })
      const second = await api.caller.decisions.record({
        retroId,
        rid: 'r-record-1',
        revision: 1,
        state: 'approved',
      })

      expect(second.version).toBe(2)
    })

    test('binds to the revision the page was showing, not the newest', async () => {
      // The round is put down before the next draft may answer it (#113
      // `r-revision-sneaks-past-review`); he can still revisit a verdict
      // afterwards, which is what this asserts.
      await api.finishRound(retroId)
      await api.revision(sessionId, [{ problem: 'A rewritten problem statement.' }, {}])

      const result = await api.caller.decisions.record({
        retroId,
        rid: 'r-record-1',
        revision: 1,
        state: 'approved',
      })

      expect(result.decision.decidedOnRevision).toBe(1)
      // Against revision 2's content that verdict does not bind.
      expect((await api.caller.records.list({ retroId })).records[0]?.state).toBe('pending')
    })

    /**
     * KC-0021. The input enum is five values; the output enum is still eight,
     * because a decision made before the cut is human data and is never
     * rewritten. Both halves are asserted here because they are the same
     * sentence read from either end.
     */
    test('is BAD_REQUEST for a solution level nothing offers any more', async () => {
      for (const cut of ['none', 'upstream', 'undecided']) {
        expect(
          await codeOf(() =>
            api.caller.decisions.record({
              retroId,
              rid: 'r-record-1',
              revision: 1,
              state: 'approved',
              solutionLevel: cut as never,
            }),
          ),
          `${cut} was accepted`,
        ).toBe('BAD_REQUEST')
      }
    })

    test('still reads back a level decided before the cut', async () => {
      // On a record filed before solutions, because that is the only shape with
      // a level of its own to carry forward. Written straight to the store,
      // because no write path can produce an `upstream` now.
      const legacy = await api.legacyRevision(sessionId)
      await api.store.decisions.add({
        retroId: legacy.retroId,
        rid: legacy.record.rid,
        version: 1,
        state: 'approved',
        severity: 2,
        solutionLevel: 'upstream',
        selectedSolution: undefined,
        involvement: 'pull-request',
        reviewerNote: undefined,
        revisionN: 1,
        contentHash: 'whatever-it-was',
        decidedAt: '2026-08-24T09:00:00.000Z',
      })

      const again = await api.caller.decisions.record({
        retroId: legacy.retroId,
        rid: legacy.record.rid,
        revision: 1,
        state: 'declined',
      })

      expect(again.decision.solutionLevel).toBe('upstream')
      expect(
        (await api.caller.records.get({ retroId: legacy.retroId, rid: legacy.record.rid })).decision
          .solutionLevel,
      ).toBe('upstream')
    })

    /**
     * The owner's *"tickmark that indicates what the human actually selected"*,
     * on the wire. The level follows the pick, so the two travel together and a
     * page never has to compute one from the other.
     */
    test('records which solution the human selected, and takes its level', async () => {
      const result = await api.caller.decisions.record({
        retroId,
        rid: 'r-record-1',
        revision: 1,
        state: 'approved',
        selectedSolution: 1,
      })

      expect(result.decision.selectedSolution).toBe(1)
      expect(result.decision.solutionLevel).toBe(1)
      expect(
        (await api.caller.records.get({ retroId, rid: 'r-record-1' })).decision.selectedSolution,
      ).toBe(1)
    })

    test('is BAD_REQUEST for a solution the record does not propose', async () => {
      expect(
        await codeOf(() =>
          api.caller.decisions.record({
            retroId,
            rid: 'r-record-1',
            revision: 1,
            state: 'approved',
            selectedSolution: 9,
          }),
        ),
      ).toBe('BAD_REQUEST')
    })

    test('is BAD_REQUEST for a level on a record whose level comes from the pick', async () => {
      expect(
        await codeOf(() =>
          api.caller.decisions.record({
            retroId,
            rid: 'r-record-1',
            revision: 1,
            state: 'approved',
            solutionLevel: 4,
          }),
        ),
      ).toBe('BAD_REQUEST')
    })

    test('is BAD_REQUEST for a selection on a record that proposes none', async () => {
      const legacy = await api.legacyRevision(sessionId)

      expect(
        await codeOf(() =>
          api.caller.decisions.record({
            retroId: legacy.retroId,
            rid: legacy.record.rid,
            revision: 1,
            state: 'approved',
            selectedSolution: 1,
          }),
        ),
      ).toBe('BAD_REQUEST')
    })

    /**
     * Retro 3 `r-hold-semantics`. The input enum is three values; the output
     * enum is still four, because a record decided `hold` before the split is
     * human data and is never rewritten. Both halves are asserted here because
     * they are the same sentence read from either end.
     */
    test('is BAD_REQUEST for `hold`, which is no longer a verdict', async () => {
      expect(
        await codeOf(() =>
          api.caller.decisions.record({
            retroId,
            rid: 'r-record-1',
            revision: 1,
            state: 'hold' as never,
          }),
        ),
      ).toBe('BAD_REQUEST')
    })

    test('still reads back a hold verdict decided before the split', async () => {
      // Written straight to the store, because no write path can produce one
      // now — and hashed against the real content, so the verdict binds rather
      // than reading as pending for a reason that has nothing to do with hold.
      const revision = await api.store.revisions.findLatestByRetro(retroId)
      await api.store.decisions.add({
        retroId,
        rid: 'r-record-1',
        version: 1,
        state: 'hold',
        severity: 2,
        solutionLevel: 2,
        selectedSolution: 2,
        involvement: 'pull-request',
        reviewerNote: 'Parked, under the old model.',
        revisionN: 1,
        contentHash: hashRecordContent(revision?.records[0] as RetroRecord),
        decidedAt: '2026-08-24T09:00:00.000Z',
      })

      const listed = await api.caller.records.list({ retroId })
      expect(listed.records[0]?.state).toBe('hold')
    })

    test('is BAD_REQUEST without a state — nothing is decided by omission', async () => {
      expect(
        await codeOf(() =>
          api.caller.decisions.record({ retroId, rid: 'r-record-1', revision: 1 } as never),
        ),
      ).toBe('BAD_REQUEST')
    })

    test('is CONFLICT once the review is finished', async () => {
      for (const rid of ['r-record-1', 'r-record-2']) {
        await api.caller.decisions.record({ retroId, rid, revision: 1, state: 'approved' })
      }
      await api.closeReview(retroId)

      expect(
        await codeOf(() =>
          api.caller.decisions.record({
            retroId,
            rid: 'r-record-1',
            revision: 1,
            state: 'declined',
          }),
        ),
      ).toBe('CONFLICT')
    })
  })

  describe('threads', () => {
    test('opens a record thread and replies to it by id alone', async () => {
      const opened = await api.caller.threads.open({
        retroId,
        target: { kind: 'record', rid: 'r-record-1', section: 'direction' },
        text: 'Let us do the smaller version first.',
      })

      const replied = await api.caller.threads.reply({
        threadId: opened.id,
        text: 'Agreed — narrowed in revision 2.',
      })

      expect(replied.id).toBe(opened.id)
      expect(replied.rid).toBe('r-record-1')
      expect(replied.section).toBe('direction')
      expect(replied.messages.map((message) => message.actor)).toEqual(['human', 'human'])
    })

    test('opens a review-level thread, anchored to nothing', async () => {
      const opened = await api.caller.threads.open({
        retroId,
        target: { kind: 'review' },
        text: 'The whole revision reads as one problem.',
      })

      expect(opened.rid).toBeNull()
      expect(opened.section).toBeNull()
    })

    test('is NOT_FOUND replying into a thread that does not exist', async () => {
      expect(await codeOf(() => api.caller.threads.reply({ threadId: 404, text: 'x' }))).toBe(
        'NOT_FOUND',
      )
    })

    test('is BAD_REQUEST for an empty comment or an unknown section', async () => {
      expect(
        await codeOf(() =>
          api.caller.threads.open({ retroId, target: { kind: 'review' }, text: '' }),
        ),
      ).toBe('BAD_REQUEST')
      expect(
        await codeOf(() =>
          api.caller.threads.open({
            retroId,
            target: { kind: 'record', rid: 'r-record-1', section: 'impact' as never },
            text: 'x',
          }),
        ),
      ).toBe('BAD_REQUEST')
    })

    /**
     * **Every thread, record-level and review-level alike.** The record thread
     * opened alongside is the whole test: it filtered to review-level threads
     * until session 7, and the owner asked for the opposite — *"Replace inline
     * comments in retro body with comments in the side panel … This enables
     * human to see all comments in one place."* A panel missing the record
     * comments would fail here rather than in a browser.
     */
    test('list returns every thread of the retrospective, record-level included', async () => {
      const record = await api.caller.threads.open({
        retroId,
        target: { kind: 'record', rid: 'r-record-1', section: 'problem' },
        text: 'This section is understated.',
      })
      const review = await api.caller.threads.open({
        retroId,
        target: { kind: 'review' },
        text: 'Two of these records are the same complaint.',
      })

      const listed = await api.caller.threads.list({ retroId })

      expect(listed.map((thread) => thread.id)).toEqual([record.id, review.id])
      expect(listed[0]).toEqual({
        id: record.id,
        rid: 'r-record-1',
        section: 'problem',
        openedAt: '2026-08-24T09:00:00.000Z',
        resolved: false,
        messages: [
          {
            id: record.messages[0]?.id ?? 0,
            actor: 'human',
            text: 'This section is understated.',
            at: '2026-08-24T09:00:00.000Z',
            revision: 1,
          },
        ],
      })
      expect(listed[1]).toMatchObject({ rid: null, section: null, resolved: false })
    })

    /**
     * The owner: *"comment show the rev number they are associated with"*. A
     * revision is announced and never swapped in (KC-0005), so the page sends
     * the revision it is showing and the server stores that — not the newest.
     */
    test('stores the revision the page was showing, and the latest when it sends none', async () => {
      await api.finishRound(retroId)
      await api.revision(sessionId, [{}, {}, {}])

      const pinned = await api.caller.threads.open({
        retroId,
        target: { kind: 'review' },
        text: 'Raised while revision 1 was still on screen.',
        revision: 1,
      })
      const current = await api.caller.threads.reply({
        threadId: pinned.id,
        text: 'And this one from the revision that is current.',
      })

      expect(current.messages.map((message) => message.revision)).toEqual([1, 2])
    })

    test('open is BAD_REQUEST for a revision the retrospective does not have', async () => {
      expect(
        await codeOf(() =>
          api.caller.threads.open({
            retroId,
            target: { kind: 'review' },
            text: 'from a draft nobody filed',
            revision: 9,
          }),
        ),
      ).toBe('BAD_REQUEST')
    })

    /**
     * `r-resolvable-comments`. The browser's context actor is `human`
     * unconditionally, so this procedure always passes the guard — what is
     * asserted here is the state it writes and that reopening is another
     * version rather than an erasure. That the *AI* cannot reach it is proved
     * one layer down, in the core's actor sweep, which is where a guard below
     * every adapter belongs.
     */
    test('resolve marks a thread, reopening it is another act, and the list follows', async () => {
      const thread = await api.caller.threads.open({
        retroId,
        target: { kind: 'review' },
        text: 'Two of these records are the same complaint.',
      })
      expect(thread.resolved).toBe(false)

      expect(
        (await api.caller.threads.resolve({ threadId: thread.id, resolved: true })).resolved,
      ).toBe(true)
      expect((await api.caller.threads.list({ retroId }))[0]?.resolved).toBe(true)

      expect(
        (await api.caller.threads.resolve({ threadId: thread.id, resolved: false })).resolved,
      ).toBe(false)
      expect((await api.caller.threads.list({ retroId }))[0]?.resolved).toBe(false)
    })

    test('resolve is NOT_FOUND for a thread that does not exist', async () => {
      expect(
        await codeOf(() => api.caller.threads.resolve({ threadId: 404, resolved: true })),
      ).toBe('NOT_FOUND')
    })

    test('resolve is CONFLICT once the review is finished', async () => {
      const thread = await api.caller.threads.open({
        retroId,
        target: { kind: 'review' },
        text: 'Something to settle later.',
      })
      for (const rid of ['r-record-1', 'r-record-2']) {
        await api.caller.decisions.record({ retroId, rid, revision: 1, state: 'approved' })
      }
      await api.closeReview(retroId)

      expect(
        await codeOf(() => api.caller.threads.resolve({ threadId: thread.id, resolved: true })),
      ).toBe('CONFLICT')
    })

    test('list is an empty array on a review nobody has commented on', async () => {
      expect(await api.caller.threads.list({ retroId })).toEqual([])
    })

    test('list is NOT_FOUND for a retrospective that does not exist', async () => {
      expect(await codeOf(() => api.caller.threads.list({ retroId: 404 }))).toBe('NOT_FOUND')
    })
  })

  describe('review', () => {
    /**
     * The page's one terminal action (retro 4 `r-one-finish-button`), and what
     * it does *not* do: the retrospective is still `reviewing` afterwards.
     * Closing it to export is the AI's act, through the CLI — there is no
     * procedure for it, which the procedure list above is what guards.
     *
     * The wire says `submitted` and the store still says `reviewing`, and both
     * halves are asserted because that gap is the whole feature: the fourth
     * word is a *reading* of an unchanged row (`retro.view.ts`), and a test
     * that only read the wire could not tell a derivation from a transition
     * somebody added here.
     */
    test('finish closes the human’s side of the round and leaves the stored retro reviewing', async () => {
      for (const rid of ['r-record-1', 'r-record-2']) {
        await api.caller.decisions.record({ retroId, rid, revision: 1, state: 'approved' })
      }

      const outcome = await api.caller.review.finish({ retroId })

      expect(outcome).toEqual({
        retroId,
        state: 'submitted',
        revision: 1,
        finishedAt: null,
      })
      expect((await api.store.retrospectives.findById(retroId))?.state).toBe('reviewing')
    })

    test('finish is PRECONDITION_FAILED with the pending rids while any record is undecided', async () => {
      await api.caller.decisions.record({
        retroId,
        rid: 'r-record-1',
        revision: 1,
        state: 'approved',
      })

      try {
        await api.caller.review.finish({ retroId })
        throw new Error('expected the finish gate to refuse')
      } catch (error) {
        const failure = error as TRPCError
        expect(failure.code).toBe('PRECONDITION_FAILED')
        // The payload is the point: a page that cannot name the undecided records
        // can only say "no", which is the least useful thing to tell a reviewer.
        expect(pendingRidsOf(failure)).toEqual(['r-record-2'])
      }
    })

    /**
     * A second press of a one-shot action is absorbed, not refused (retro 4
     * `r-request-changes-multi-press`). The wire answer is the first one again,
     * and the outbox is what proves nothing happened twice: a second
     * `ReviewFinished` would be a second round for the AI to answer.
     */
    test('finish pressed again in the same round writes nothing and answers the same', async () => {
      for (const rid of ['r-record-1', 'r-record-2']) {
        await api.caller.decisions.record({ retroId, rid, revision: 1, state: 'approved' })
      }
      const first = await api.caller.review.finish({ retroId })

      expect(await api.caller.review.finish({ retroId })).toEqual(first)

      const { events } = await api.app.events.list.execute({ actor: 'human', retro: { retroId } })
      expect(events.filter((event) => event.name === 'ReviewFinished')).toHaveLength(1)
    })

    /**
     * `r-finish-confirm-message`: the page's confirm step offers a text box, and
     * what it sends travels on the finish rather than as one more comment. The
     * procedure is a boundary — the use case owns the write — so what these
     * assert is that the field crosses it and lands where the AI reads it.
     */
    describe('the final message', () => {
      async function decideEverything() {
        for (const rid of ['r-record-1', 'r-record-2']) {
          await api.caller.decisions.record({ retroId, rid, revision: 1, state: 'approved' })
        }
      }

      test('finish carries it to the round, and the outcome is unchanged', async () => {
        await decideEverything()

        const outcome = await api.caller.review.finish({
          retroId,
          finishMessage: 'Ship the first two; the third can wait for next week.',
        })

        expect(outcome).toEqual({ retroId, state: 'submitted', revision: 1, finishedAt: null })
        expect((await api.store.finishMessages.findLatest(retroId, 1))?.message).toBe(
          'Ship the first two; the third can wait for next week.',
        )
      })

      test('finish without one writes no round message', async () => {
        await decideEverything()

        await api.caller.review.finish({ retroId })

        expect(await api.store.finishMessages.findLatest(retroId, 1)).toBeUndefined()
      })

      /**
       * The gate runs before anything is written, so a refused finish leaves no
       * word behind either — a message on a round that never closed would be a
       * verdict on a review still open.
       */
      test('a refused finish stores nothing', async () => {
        await api.caller.decisions.record({
          retroId,
          rid: 'r-record-1',
          revision: 1,
          state: 'approved',
        })

        expect(
          await codeOf(() => api.caller.review.finish({ retroId, finishMessage: 'Too early.' })),
        ).toBe('PRECONDITION_FAILED')
        expect(await api.store.finishMessages.findLatest(retroId, 1)).toBeUndefined()
      })

      /** The input is strict, as every input here is: an unknown key is a bad request. */
      test('rejects a key the contract does not name', async () => {
        await decideEverything()

        // Cast through `unknown`: the point is a caller that ignores the type,
        // which is the only kind of caller that can reach this branch.
        const wrongKey = { retroId, finishNote: 'the wrong key' } as unknown as {
          retroId: number
        }

        expect(await codeOf(() => api.caller.review.finish(wrongKey))).toBe('BAD_REQUEST')
      })
    })
  })
})
