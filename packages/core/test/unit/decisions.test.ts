import { beforeEach, describe, expect, test } from 'bun:test'
import { ConflictError } from '#domain/errors/conflict.error'
import { ForbiddenActorError } from '#domain/errors/forbidden-actor.error'
import { NotFoundError } from '#domain/errors/not-found.error'
import { ValidationError } from '#domain/errors/validation.error'
import type { RetroRecord } from '#domain/models/record.model'
import type { Session } from '#domain/models/session.model'
import { hashRecordContent } from '#domain/services/content-hash.service'
import { createHarness, type Harness } from '../support/harness'

describe('decisions', () => {
  let harness: Harness
  let session: Session
  let retroId: number
  let rid: string
  let record: RetroRecord

  beforeEach(async () => {
    harness = createHarness()
    session = await harness.session()
    const created = await harness.revision(session.id)
    retroId = created.retroId
    record = created.revision.records[0] as RetroRecord
    rid = record.rid
  })

  test('records the human’s verdict, seeded from the AI’s proposals', async () => {
    const { decision, record } = await harness.app.decisions.record.execute({
      actor: 'human',
      retro: { retroId },
      rid,
      decision: { state: 'approved' },
    })

    expect(decision.version).toBe(1)
    expect(decision.state).toBe('approved')
    expect(decision.revisionN).toBe(1)
    expect(decision.decidedAt).toBe(harness.clock.iso())
    // Seeded from the proposals of the record it was made against — including
    // the solution the AI recommended, whose level is the level it carries.
    expect(decision.severity).toBe(3)
    expect(decision.selectedSolution).toBe(2)
    expect(decision.solutionLevel).toBe(2)
    expect(decision.involvement).toBe('pull-request')
    expect(record.decision.state).toBe('approved')
    expect(await harness.eventNames()).toEqual([
      'SessionCreated',
      'RetrospectiveStarted',
      'RevisionCreated',
      'DecisionRecorded',
    ])
  })

  test('takes the human’s own values over the proposals', async () => {
    const { decision } = await harness.app.decisions.record.execute({
      actor: 'human',
      retro: { retroId },
      rid,
      decision: {
        state: 'approved',
        severity: 1,
        selectedSolution: 1,
        involvement: 'autonomous',
        reviewerNote: 'The cheap one is enough.',
      },
    })

    expect(decision.severity).toBe(1)
    // Solution 1 of the fixture is the level-1 one, and the level follows the
    // pick rather than being a second thing the reviewer had to set.
    expect(decision.selectedSolution).toBe(1)
    expect(decision.solutionLevel).toBe(1)
    expect(decision.involvement).toBe('autonomous')
    expect(decision.reviewerNote).toBe('The cheap one is enough.')
  })

  /**
   * The write side marks which solution the human actually selected, and
   * separately which one the AI recommends. The selection is the human's, the
   * recommendation is the AI's, and the fallback between them is the shape the
   * three dials already had — a reviewer who accepts the recommendation says so
   * by leaving it alone and pressing a verdict.
   */
  describe('the solution a human selects', () => {
    const decide = (decision: Record<string, unknown>) =>
      harness.app.decisions.record.execute({
        actor: 'human',
        retro: { retroId },
        rid,
        decision: { state: 'approved', ...decision },
      })

    test('falls back to the one the AI recommended, and takes its level', async () => {
      const { decision } = await decide({})

      expect(decision.selectedSolution).toBe(2)
      expect(decision.solutionLevel).toBe(2)
    })

    test('carries the human’s earlier pick through a verdict that says nothing', async () => {
      await decide({ selectedSolution: 1 })
      const { decision } = await decide({ state: 'declined' })

      expect(decision.version).toBe(2)
      expect(decision.selectedSolution).toBe(1)
      expect(decision.solutionLevel).toBe(1)
    })

    test('refuses an index the record has no solution for', async () => {
      const refused = decide({ selectedSolution: 4 })

      await expect(refused).rejects.toBeInstanceOf(ValidationError)
      await expect(refused).rejects.toThrow(/selectedSolution|2 solution/)
    })

    test('refuses a zero or negative index before it reaches the record', async () => {
      await expect(decide({ selectedSolution: 0 })).rejects.toBeInstanceOf(ValidationError)
      await expect(decide({ selectedSolution: -1 })).rejects.toBeInstanceOf(ValidationError)
    })

    /**
     * Two ways to set one value is two answers that can disagree, so the record's
     * shape decides which field is the one that speaks. Refusing loudly rather
     * than ignoring the other is the same rule as everywhere else: nothing is
     * inferred from what the human did not mean.
     */
    test('refuses a solution level on a record whose level comes from the pick', async () => {
      const refused = decide({ solutionLevel: 4 })

      await expect(refused).rejects.toBeInstanceOf(ValidationError)
      await expect(refused).rejects.toThrow(/selectedSolution/)
    })

    test('refuses a selection on a record that proposes none', async () => {
      const legacy = await harness.legacyRevision(session.id, {})
      const refused = harness.app.decisions.record.execute({
        actor: 'human',
        retro: { retroId: legacy.retroId },
        rid: legacy.record.rid,
        decision: { state: 'approved', selectedSolution: 1 },
      })

      await expect(refused).rejects.toBeInstanceOf(ValidationError)
      await expect(refused).rejects.toThrow(/no solutions/)
    })

    /**
     * The selection is a human field, and the AI can never write one. The guard
     * is the use case's first line and covers every field the verdict carries,
     * but a field nobody has watched refuse the AI is a field nobody has
     * checked.
     */
    test('is closed to the AI, like every other half of a verdict', async () => {
      await expect(
        harness.app.decisions.record.execute({
          actor: 'ai',
          retro: { retroId },
          rid,
          decision: { state: 'approved', selectedSolution: 1 },
        }),
      ).rejects.toBeInstanceOf(ForbiddenActorError)

      expect(await harness.store.decisions.listForRecord(retroId, rid)).toHaveLength(0)
    })
  })

  /**
   * The list of solution levels is cut to only L1 through L5. The cut
   * is enforced where a decision is written, not where one is read — a value the
   * UI cannot offer must not be reachable by any other caller either, and the
   * refusal has to name the field so a CLI user sees what was wrong.
   */
  describe('the solution level a human may choose, on a record that has one', () => {
    let legacyRetroId: number
    let legacyRid: string

    beforeEach(async () => {
      // The dial only exists on a record filed before solutions did; on the new
      // shape the level is the selected solution's, which is the describe above.
      const legacy = await harness.legacyRevision(session.id, {})
      legacyRetroId = legacy.retroId
      legacyRid = legacy.record.rid
    })

    const decide = (solutionLevel: unknown) =>
      harness.app.decisions.record.execute({
        actor: 'human',
        retro: { retroId: legacyRetroId },
        rid: legacyRid,
        decision: { state: 'approved', solutionLevel },
      })

    test('is one of the five levels', async () => {
      expect((await decide(1)).decision.solutionLevel).toBe(1)
      expect((await decide(5)).decision.solutionLevel).toBe(5)
    })

    test('leaves the selection empty — there was nothing to select between', async () => {
      expect((await decide(3)).decision.selectedSolution).toBeUndefined()
    })

    for (const cut of ['none', 'upstream', 'undecided']) {
      test(`refuses ${cut}, which nothing offers any more`, async () => {
        await expect(decide(cut)).rejects.toBeInstanceOf(ValidationError)
        await expect(decide(cut)).rejects.toThrow(/solutionLevel/)
      })
    }

    /**
     * The append-only rule doing its job: a record already carrying a cut value
     * keeps it through a verdict that says nothing about the level. Rewriting it
     * to something the human never chose would be worse than leaving it.
     */
    test('leaves a level it can no longer name exactly where it was', async () => {
      // As the store holds it for retro 1 — written before the cut, by hand,
      // because no write path can produce one now.
      await harness.store.decisions.add({
        retroId: legacyRetroId,
        rid: legacyRid,
        version: 1,
        state: 'approved',
        severity: 2,
        solutionLevel: 'upstream',
        selectedSolution: undefined,
        involvement: 'pull-request',
        reviewerNote: undefined,
        revisionN: 1,
        contentHash: 'whatever-it-was',
        decidedAt: harness.clock.iso(),
      })

      const { decision } = await harness.app.decisions.record.execute({
        actor: 'human',
        retro: { retroId: legacyRetroId },
        rid: legacyRid,
        decision: { state: 'declined' },
      })

      expect(decision.state).toBe('declined')
      expect(decision.solutionLevel).toBe('upstream')
    })
  })

  /**
   * **A later revision's proposals cannot touch a ruling.** The AI re-files a
   * record every round, `defaults` and all; if those numbers could land on a
   * decided record, every round would quietly re-open settled judgments — and
   * the AI would be deciding by the back door.
   *
   * They cannot: the proposals seed a record with **no decision**, and after
   * that the fallback chain in `record-decision.use-case.ts` reads the previous
   * decision, never the new draft. This is what lets SKILL.md tell a cold agent
   * to carry his values forward without fear, and — the case that has no other
   * answer — to put any legal 1–5 in `defaults.solutionLevel` for a record he
   * ruled with a legacy level the input schema can no longer accept.
   */
  test('a later revision’s proposals never overwrite a ruling', async () => {
    await harness.app.decisions.record.execute({
      actor: 'human',
      retro: { retroId },
      rid,
      decision: { state: 'approved', severity: 1, selectedSolution: 1, involvement: 'other' },
    })

    // Same narrative — so the verdict carries — with different proposals.
    await harness.finishRound(retroId)
    await harness.revision(session.id, [
      {
        rid,
        num: record.num,
        defaults: { severity: 5, involvement: 'autonomous' },
      },
    ])

    const [view] = (await harness.app.records.list.execute({ actor: 'ai', retro: { retroId } }))
      .records

    expect(view?.decision.state).toBe('approved')
    expect(view?.decision.severity).toBe(1)
    expect(view?.decision.selectedSolution).toBe(1)
    expect(view?.decision.solutionLevel).toBe(1)
    expect(view?.decision.involvement).toBe('other')
  })

  /**
   * The same, for the level nothing may write any more: a record he ruled
   * `upstream` keeps it however the next draft is filed.
   */
  test('a legacy level survives whatever the next draft proposes', async () => {
    const legacy = await harness.legacyRevision(session.id, {})
    await harness.store.decisions.add({
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
      contentHash: hashRecordContent(legacy.record),
      decidedAt: harness.clock.iso(),
    })

    const [view] = (
      await harness.app.records.list.execute({ actor: 'ai', retro: { retroId: legacy.retroId } })
    ).records

    expect(view?.decision.solutionLevel).toBe('upstream')
    expect(view?.decision.state).toBe('approved')
  })

  test('appends a version and keeps the previous one — history is never lost', async () => {
    await harness.app.decisions.record.execute({
      actor: 'human',
      retro: { retroId },
      rid,
      decision: { state: 'declined', severity: 5, reviewerNote: 'Not now.' },
    })
    const { decision } = await harness.app.decisions.record.execute({
      actor: 'human',
      retro: { retroId },
      rid,
      decision: { state: 'approved' },
    })

    expect(decision.version).toBe(2)
    // Values the reviewer did not touch this time stay theirs, not the AI's.
    expect(decision.severity).toBe(5)
    expect(decision.reviewerNote).toBe('Not now.')
    expect(await harness.store.decisions.listForRecord(retroId, rid)).toHaveLength(2)
  })

  /**
   * The third verdict (`r-verdict-revise`), and its undo: approve, decline and
   * request-a-revision are each one press, and pressing the same one again
   * undoes it rather than leaving it pressed.
   */
  describe('revise, and undoing a verdict', () => {
    test('moves the record out of pending like the other two', async () => {
      const { decision } = await harness.app.decisions.record.execute({
        actor: 'human',
        retro: { retroId },
        rid,
        decision: { state: 'revise', reviewerNote: 'Say what it cost, not that it cost.' },
      })

      expect(decision.state).toBe('revise')
      const status = await harness.app.review.status.execute({ actor: 'ai', retro: { retroId } })
      expect(status.counts).toMatchObject({ pending: 0, revise: 1 })
    })

    /**
     * The undo is one more append, not an edit and not a deletion: the verdict
     * that was undone stays exactly where the human left it, which is the whole
     * of the append-only rule (D4).
     */
    test('undoing appends a `pending` version and keeps the one it undid', async () => {
      await harness.decide(retroId, rid, 'approved')
      const { decision } = await harness.app.decisions.record.execute({
        actor: 'human',
        retro: { retroId },
        rid,
        decision: { state: 'pending' },
      })

      expect(decision.version).toBe(2)
      expect(decision.state).toBe('pending')

      const history = await harness.store.decisions.listForRecord(retroId, rid)
      expect(history.map((row) => row.state)).toEqual(['approved', 'pending'])

      const { records } = await harness.app.records.list.execute({
        actor: 'ai',
        retro: { retroId },
      })
      expect(records[0]?.decision.state).toBe('pending')
    })
  })

  test('declining keeps the record — decline is a state, never a deletion', async () => {
    await harness.app.decisions.record.execute({
      actor: 'human',
      retro: { retroId },
      rid,
      decision: { state: 'declined', reviewerNote: 'Not a real problem.' },
    })

    const { records } = await harness.app.records.list.execute({ actor: 'ai', retro: { retroId } })
    expect(records).toHaveLength(1)
    expect(records[0]?.decision.state).toBe('declined')
    expect(records[0]?.decision.reviewerNote).toBe('Not a real problem.')
  })

  test('binds to the revision the reviewer was looking at, not to the newest one', async () => {
    // The rhythm the gate enforces (`r-revision-sneaks-past-review`): the
    // human marks the record for a rewrite and finishes the round, and the AI's
    // next draft answers it. He can still revisit a verdict afterwards
    // (`r-verdict-revise`), and that is what this test is about — a verdict
    // recorded against revision 1 while revision 2 is the newest.
    await harness.decide(retroId, rid, 'revise')
    await harness.app.review.finish.execute({ actor: 'human', retro: { retroId } })
    await harness.revision(session.id, [{ rid, num: 1, problem: 'A rewritten problem.' }])

    const { decision } = await harness.app.decisions.record.execute({
      actor: 'human',
      retro: { retroId },
      rid,
      revision: 1,
      decision: { state: 'approved' },
    })

    expect(decision.revisionN).toBe(1)
    // Against revision 2's content that verdict does not bind: the record is pending again.
    const { records } = await harness.app.records.list.execute({ actor: 'ai', retro: { retroId } })
    expect(records[0]?.decision.state).toBe('pending')
    expect(records[0]?.decision.contentChangedSince).toBe(1)
  })

  /**
   * `r-hold-semantics`: hold is not a review status a retro item can be in.
   * The narrowing is at the write path, the same shape solution level was
   * narrowed to — so a store that already holds one keeps it, and nothing can
   * make another.
   */
  describe('hold is no longer a verdict', () => {
    test('refuses `hold` as a state', async () => {
      const refused = harness.app.decisions.record.execute({
        actor: 'human',
        retro: { retroId },
        rid,
        decision: { state: 'hold' },
      })

      await expect(refused).rejects.toBeInstanceOf(ValidationError)
      await expect(refused).rejects.toThrow(/state/)
    })

    test('still reads one a store already holds, and lets a new verdict pass it by', async () => {
      // Written straight to the store, because no write path can produce one now.
      await harness.store.decisions.add({
        retroId,
        rid,
        version: 1,
        state: 'hold',
        severity: 3,
        solutionLevel: 2,
        selectedSolution: 2,
        involvement: 'pull-request',
        reviewerNote: 'Parked, under the old model.',
        revisionN: 1,
        contentHash: hashRecordContent(record),
        decidedAt: harness.clock.iso(),
      })

      const { records } = await harness.app.records.list.execute({
        actor: 'ai',
        retro: { retroId },
      })
      expect(records[0]?.decision.state).toBe('hold')

      const { decision } = await harness.app.decisions.record.execute({
        actor: 'human',
        retro: { retroId },
        rid,
        decision: { state: 'approved' },
      })
      expect(decision.version).toBe(2)
      expect(decision.reviewerNote).toBe('Parked, under the old model.')
    })
  })

  test('rejects a verdict with no state, or a state that is not one of the four', async () => {
    await expect(
      harness.app.decisions.record.execute({
        actor: 'human',
        retro: { retroId },
        rid,
        decision: {},
      }),
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(
      harness.app.decisions.record.execute({
        actor: 'human',
        retro: { retroId },
        rid,
        decision: { state: 'looks-fine' },
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  test('is a NotFound for an unknown retrospective, revision or record', async () => {
    await expect(
      harness.app.decisions.record.execute({
        actor: 'human',
        retro: { retroId: 404 },
        rid,
        decision: { state: 'approved' },
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      harness.app.decisions.record.execute({
        actor: 'human',
        retro: { retroId },
        rid: 'r-ghost',
        decision: { state: 'approved' },
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      harness.app.decisions.record.execute({
        actor: 'human',
        retro: { retroId },
        rid,
        revision: 9,
        decision: { state: 'approved' },
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  test('refuses to decide a finished retrospective', async () => {
    await harness.decide(retroId, rid, 'approved')
    await harness.closeReview(retroId)

    await expect(
      harness.app.decisions.record.execute({
        actor: 'human',
        retro: { retroId },
        rid,
        decision: { state: 'declined' },
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })
})
