import { beforeEach, describe, expect, test } from 'bun:test'
import type { RecordInput } from '#application/schemas/revision-input.schema'
import { ConflictError } from '#domain/errors/conflict.error'
import { FinishGateError } from '#domain/errors/finish-gate.error'
import { ForbiddenActorError } from '#domain/errors/forbidden-actor.error'
import { NotFoundError } from '#domain/errors/not-found.error'
import type { RetroRecord } from '#domain/models/record.model'
import type { Session } from '#domain/models/session.model'
import { hashRecordContent } from '#domain/services/content-hash.service'
import { createHarness, type Harness } from '../support/harness'

describe('review', () => {
  let harness: Harness
  let session: Session

  beforeEach(async () => {
    harness = createHarness()
    session = await harness.session()
  })

  describe('status', () => {
    test('counts the latest revision’s records by effective state', async () => {
      const { retroId, revision } = await harness.revision(session.id, [{}, {}, {}])
      await harness.decide(retroId, revision.records[0]?.rid ?? '', 'approved')
      await harness.decide(retroId, revision.records[1]?.rid ?? '', 'declined')

      const status = await harness.app.review.status.execute({ actor: 'ai', retro: { retroId } })

      expect(status.state).toBe('reviewing')
      expect(status.finished).toBe(false)
      expect(status.revisionN).toBe(1)
      expect(status.counts).toEqual({
        pending: 1,
        approved: 1,
        declined: 1,
        // The third verdict, counted like the others (retro 4
        // `r-verdict-revise`) — this is where the AI reads that a record was
        // sent back for a rewrite.
        revise: 0,
        // Frozen: nothing writes a `hold` verdict any more, and this store never
        // held one (`r-hold-semantics`). There is no `held` count beside it —
        // the lifecycle flag that had one is gone (retro 4 `r-remove-hold`).
        hold: 0,
        total: 3,
      })
    })

    test('counts a carried-over decision as decided', async () => {
      const { retroId } = await harness.revision(session.id, [{ rid: 'r-one', num: 1 }])
      await harness.decide(retroId, 'r-one', 'approved')
      await harness.finishRound(retroId)
      await harness.revision(session.id, [{ rid: 'r-one', num: 1 }])

      expect(
        (await harness.app.review.status.execute({ actor: 'ai', retro: { retroId } })).counts,
      ).toEqual({ pending: 0, approved: 1, declined: 0, revise: 0, hold: 0, total: 1 })
    })

    test('reports an empty count before the first revision lands', async () => {
      const retro = await harness.store.retrospectives.add({
        sessionId: session.id,
        state: 'open',
        startedAt: harness.clock.iso(),
        finishedAt: undefined,
      })

      const status = await harness.app.review.status.execute({
        actor: 'ai',
        retro: { retroId: retro.id },
      })

      expect(status.revisionN).toBeUndefined()
      expect(status.counts.total).toBe(0)
    })

    /**
     * The owner's session-11 add, in the field the AI reads between its `review
     * wait` and its `review close`: *"There should be a status in between that
     * indicates that the human has submitted but AI hasn't closed"*. That window
     * is exactly the stretch this use case is called in, so the word has to be
     * here and not only in the browser.
     *
     * `finished` is asserted at all three points beside it, because it is the
     * field every script that already parses this output keys off: it answers
     * the *stored* terminal state and the fourth word must not have moved it.
     */
    test('says submitted between his finish and the AI’s close, and finished after', async () => {
      const { retroId } = await harness.revision(session.id, [{ rid: 'r-one', num: 1 }])
      const status = async () =>
        await harness.app.review.status.execute({ actor: 'ai', retro: { retroId } })

      expect((await status()).state).toBe('reviewing')
      expect((await status()).finished).toBe(false)

      await harness.finishRound(retroId)
      expect((await status()).state).toBe('submitted')
      expect((await status()).finished).toBe(false)

      await harness.app.review.close.execute({ actor: 'ai', retro: { retroId } })
      expect((await status()).state).toBe('finished')
      expect((await status()).finished).toBe(true)
    })

    /**
     * The reading is about the round that is current, not about any round: the
     * AI answering a finished round with a new draft hands the retro back, and
     * a `submitted` that survived that would be a permanent lie on every retro
     * that ever had two revisions.
     */
    test('goes back to reviewing once the AI files the next revision', async () => {
      const { retroId } = await harness.revision(session.id, [{ rid: 'r-one', num: 1 }])
      await harness.finishRound(retroId)
      expect(
        (await harness.app.review.status.execute({ actor: 'ai', retro: { retroId } })).state,
      ).toBe('submitted')

      await harness.revision(session.id, [{ rid: 'r-one', num: 1 }])

      expect(
        (await harness.app.review.status.execute({ actor: 'ai', retro: { retroId } })).state,
      ).toBe('reviewing')
    })

    test('is a NotFound for an unknown retrospective', async () => {
      await expect(
        harness.app.review.status.execute({ actor: 'ai', retro: { retroId: 404 } }),
      ).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  /**
   * `review.listFinished` — every round the human has put down, across the whole
   * stage, for an AI that was not watching when he pressed the button.
   *
   * `review wait` answers about one retrospective and only about finishes that
   * land while it blocks; an agent that started after the press, or that is
   * catching up on a stage it has never read, has no way to ask "what is waiting
   * for me?". This is that read, and it is addressed to nothing: the caller names
   * no retrospective and no session.
   *
   * **Finished means the latest revision was finished.** A round the AI has
   * already answered with a new draft is not waiting for anyone, so a
   * retrospective whose revision 1 was finished and whose revision 2 is open
   * does not appear — the same rule `review wait` applies to a single event, on
   * the whole stage at once.
   */
  describe('listFinished', () => {
    const rows = async () =>
      (await harness.app.review.listFinished.execute({ actor: 'ai' })).reviews

    test('lists nothing while no round has been put down', async () => {
      expect(await rows()).toEqual([])

      await harness.revision(session.id, [{}])

      expect(await rows()).toEqual([])
    })

    /**
     * The whole read in one walk: two sessions, three retrospectives, and the
     * three readings that matter — which rows appear, in what order, and with
     * which ordinal.
     *
     * The ordinal is the position **within the session** and the order is retro
     * id ascending, so the two deliberately disagree here: the second listed row
     * is the third retrospective the stage ever had and the second of *its*
     * session. A `retroNumber` that were really the id would pass a flatter
     * scenario and fail a reader reading "Retro #2" off a dashboard.
     */
    test('lists every finished round oldest first, numbered within its session', async () => {
      const first = await harness.revision(session.id, [{}, {}])
      await harness.decide(first.retroId, 'r-record-1', 'approved')
      await harness.decide(first.retroId, 'r-record-2', 'declined')
      harness.clock.advance(60_000)
      await harness.closeReview(first.retroId)
      const firstFinishedAt = harness.clock.iso()

      // Another session's retrospective, still with the human — and started
      // between the two below, so its id sits between theirs.
      const other = await harness.session('uuid-other')
      const reviewing = await harness.revision(other.id, [{}])

      harness.clock.advance(60_000)
      const second = await harness.revision(session.id, [{}])
      await harness.decide(second.retroId, 'r-record-1', 'approved')
      harness.clock.advance(60_000)
      await harness.app.review.finish.execute({
        actor: 'human',
        retro: { retroId: second.retroId },
      })
      const secondFinishedAt = harness.clock.iso()

      expect(await rows()).toEqual([
        {
          retroId: first.retroId,
          retroNumber: 1,
          sessionId: session.id,
          claudeSession: session.claudeSession,
          finishedAt: firstFinishedAt,
          // The stored terminal state, which only `review close` writes.
          closed: true,
          revisionN: 1,
          counts: { pending: 0, approved: 1, declined: 1, revise: 0, hold: 0, total: 2 },
        },
        {
          retroId: second.retroId,
          retroNumber: 2,
          sessionId: session.id,
          claudeSession: session.claudeSession,
          finishedAt: secondFinishedAt,
          // He has finished it and the AI has not closed it — the window
          // `review status` calls `submitted`, and the reason this row exists.
          closed: false,
          revisionN: 1,
          counts: { pending: 0, approved: 1, declined: 0, revise: 0, hold: 0, total: 1 },
        },
      ])
      expect((await rows()).map((row) => row.retroId)).not.toContain(reviewing.retroId)
    })

    /**
     * The round the AI has already answered (#113 `r-revision-sneaks-past-review`
     * put the finish before the next draft, so this pair is the normal rhythm).
     * Its `ReviewFinished` is still in the outbox forever; what changed is that
     * it is no longer about the revision under review.
     */
    test('drops a retrospective the AI has answered with a new revision', async () => {
      const { retroId } = await harness.revision(session.id, [{}])
      await harness.finishRound(retroId)
      expect((await rows()).map((row) => row.retroId)).toEqual([retroId])

      await harness.revision(session.id, [{}])

      expect(await rows()).toEqual([])
    })
  })

  /**
   * The human's one button (retro 4 `r-one-finish-button`). It ends *his* side
   * of the round and nothing else: the retrospective stays `reviewing` until
   * the AI closes it, which is the describe below this one.
   */
  describe('finish', () => {
    test('closes the human’s side of the round and leaves the retro reviewing', async () => {
      const { retroId, revision } = await harness.revision(session.id, [{}, {}])
      await harness.decide(retroId, revision.records[0]?.rid ?? '', 'approved')
      await harness.decide(retroId, revision.records[1]?.rid ?? '', 'declined')

      const result = await harness.app.review.finish.execute({ actor: 'human', retro: { retroId } })

      expect(result.finishedNow).toBe(true)
      expect(result.retrospective.state).toBe('reviewing')
      expect(result.retrospective.finishedAt).toBeUndefined()
      expect(result.revisionN).toBe(1)
      expect((await harness.eventNames()).at(-1)).toBe('ReviewFinished')
    })

    test('refuses while any record is pending, and names them', async () => {
      const { retroId, revision } = await harness.revision(session.id, [{}, {}])
      await harness.decide(retroId, revision.records[0]?.rid ?? '', 'approved')

      const failure = harness.app.review.finish.execute({ actor: 'human', retro: { retroId } })

      await expect(failure).rejects.toBeInstanceOf(FinishGateError)
      await failure.catch((error: unknown) => {
        expect((error as FinishGateError).pendingRids).toEqual([revision.records[1]?.rid ?? ''])
      })
      expect((await harness.store.retrospectives.findById(retroId))?.state).toBe('reviewing')
      expect(await harness.eventNames()).not.toContain('ReviewFinished')
    })

    /**
     * A `hold` verdict is history (`r-hold-semantics`) and no write path can
     * produce one — but retro 1 could have, so the gate has to keep treating a
     * stored one as decided. Written straight to the store, because that is the
     * only way one exists now.
     */
    test('still counts a legacy hold verdict as decided', async () => {
      const { retroId, revision } = await harness.revision(session.id)
      const record = revision.records[0]
      await harness.store.decisions.add({
        retroId,
        rid: record?.rid ?? '',
        version: 1,
        state: 'hold',
        severity: 3,
        solutionLevel: 2,
        selectedSolution: 2,
        involvement: 'pull-request',
        reviewerNote: undefined,
        revisionN: 1,
        contentHash: hashRecordContent(record as RetroRecord),
        decidedAt: harness.clock.iso(),
      })

      const status = await harness.app.review.status.execute({ actor: 'ai', retro: { retroId } })
      expect(status.counts).toMatchObject({ pending: 0, hold: 1 })

      const result = await harness.app.review.finish.execute({ actor: 'human', retro: { retroId } })
      expect(result.finishedNow).toBe(true)
    })

    /**
     * A `revise` record is decided, so the gate lets the review finish (retro 4
     * `r-verdict-revise`): asking for a rewrite is an answer, and the owner's
     * workflow is to give every record one of the three and then press the one
     * button. What happens with the ask afterwards is the AI's next step, not
     * the gate's business.
     */
    test('counts a revise verdict as decided', async () => {
      const { retroId, revision } = await harness.revision(session.id, [{}, {}])
      await harness.decide(retroId, revision.records[0]?.rid ?? '', 'approved')
      await harness.decide(retroId, revision.records[1]?.rid ?? '', 'revise')

      const result = await harness.app.review.finish.execute({ actor: 'human', retro: { retroId } })
      expect(result.revisionN).toBe(1)
      expect((await harness.eventNames()).at(-1)).toBe('ReviewFinished')
    })

    test('passes on carried-over decisions and blocks again when content changed', async () => {
      const { retroId } = await harness.revision(session.id, [
        { rid: 'r-one', num: 1 },
        { rid: 'r-two', num: 2 },
      ])
      await harness.decide(retroId, 'r-one', 'approved')
      await harness.decide(retroId, 'r-two', 'approved')
      await harness.finishRound(retroId)

      await harness.revision(session.id, [
        { rid: 'r-one', num: 1 },
        { rid: 'r-two', num: 2, problem: 'A rewritten problem statement.' },
      ])

      await expect(
        harness.app.review.finish.execute({ actor: 'human', retro: { retroId } }),
      ).rejects.toBeInstanceOf(FinishGateError)

      await harness.decide(retroId, 'r-two', 'approved')
      expect(
        (await harness.app.review.finish.execute({ actor: 'human', retro: { retroId } }))
          .finishedNow,
      ).toBe(true)
    })

    /**
     * Retro 4 `r-request-changes-multi-press`, the owner: *"why am I
     * able to press it multiple times?"* The second press is absorbed rather
     * than refused — a repeat of an act that already happened is not an error
     * anybody can act on, and an error toast on a double-click would be one
     * more thing to read. What must not happen is a second event, because a
     * second event is a second round the AI would answer.
     */
    test('absorbs a second press of the same round: one event, same answer', async () => {
      const { retroId, revision } = await harness.revision(session.id)
      await harness.decide(retroId, revision.records[0]?.rid ?? '', 'approved')

      const first = await harness.app.review.finish.execute({ actor: 'human', retro: { retroId } })
      const second = await harness.app.review.finish.execute({ actor: 'human', retro: { retroId } })
      const third = await harness.app.review.finish.execute({ actor: 'human', retro: { retroId } })

      expect(first.finishedNow).toBe(true)
      expect(second.finishedNow).toBe(false)
      expect(third.finishedNow).toBe(false)
      expect(second.revisionN).toBe(first.revisionN)
      expect((await harness.eventNames()).filter((name) => name === 'ReviewFinished')).toHaveLength(
        1,
      )
    })

    /**
     * The other half of "once per round": a *round* is a revision, so the next
     * revision may be finished again. Without that, a review could only ever be
     * finished once and the loop would end at the first round.
     */
    test('is offered again once the AI has filed the next revision', async () => {
      const { retroId } = await harness.revision(session.id, [{ rid: 'r-one', num: 1 }])
      await harness.decide(retroId, 'r-one', 'approved')
      await harness.app.review.finish.execute({ actor: 'human', retro: { retroId } })

      await harness.revision(session.id, [
        { rid: 'r-one', num: 1, problem: 'A rewritten problem statement.' },
      ])
      await harness.decide(retroId, 'r-one', 'approved')

      const second = await harness.app.review.finish.execute({ actor: 'human', retro: { retroId } })
      expect(second.finishedNow).toBe(true)
      expect(second.revisionN).toBe(2)
      expect((await harness.eventNames()).filter((name) => name === 'ReviewFinished')).toHaveLength(
        2,
      )
    })

    /**
     * The half of `r-finish-confirm-message` that is not the confirm: a valid
     * finish may carry his final word on the round, and it files with the finish
     * rather than as one more comment — the owner: *"this message is going to be
     * delivered separately from the comments"*.
     */
    describe('the final message', () => {
      async function aDecidedRound() {
        const { retroId, revision } = await harness.revision(session.id)
        await harness.decide(retroId, revision.records[0]?.rid ?? '', 'approved')
        return { retroId, revisionN: revision.n }
      }

      test('files with the finish, on the round, in the same unit of work', async () => {
        const { retroId, revisionN } = await aDecidedRound()

        await harness.app.review.finish.execute({
          actor: 'human',
          retro: { retroId },
          finishMessage: 'Ship the first two; the third can wait for next week.',
        })

        const stored = await harness.store.finishMessages.findLatest(retroId, revisionN)
        expect(stored?.message).toBe('Ship the first two; the third can wait for next week.')
        expect(stored?.version).toBe(1)
        expect(stored?.at).toBe(harness.clock.iso())
        expect((await harness.eventNames()).at(-1)).toBe('ReviewFinished')
      })

      test('is optional — a finish without one writes no row', async () => {
        const { retroId, revisionN } = await aDecidedRound()

        await harness.app.review.finish.execute({ actor: 'human', retro: { retroId } })

        expect(await harness.store.finishMessages.findLatest(retroId, revisionN)).toBeUndefined()
      })

      /** An empty box is not a message: blank is the same as absent (KC-0010). */
      test('writes nothing for a blank one', async () => {
        const { retroId, revisionN } = await aDecidedRound()

        await harness.app.review.finish.execute({
          actor: 'human',
          retro: { retroId },
          finishMessage: '   \n  ',
        })

        expect(await harness.store.finishMessages.findLatest(retroId, revisionN)).toBeUndefined()
      })

      test('is stored trimmed', async () => {
        const { retroId, revisionN } = await aDecidedRound()

        await harness.app.review.finish.execute({
          actor: 'human',
          retro: { retroId },
          finishMessage: '  Good round.\n',
        })

        expect((await harness.store.finishMessages.findLatest(retroId, revisionN))?.message).toBe(
          'Good round.',
        )
      })

      /**
       * The message rides the press, and an absorbed press is not a press
       * (`r-request-changes-multi-press`). A second word on a round that already
       * has one would be an edit by another name.
       */
      test('a second press of the same round changes nothing', async () => {
        const { retroId, revisionN } = await aDecidedRound()
        await harness.app.review.finish.execute({
          actor: 'human',
          retro: { retroId },
          finishMessage: 'The word that stands.',
        })

        const second = await harness.app.review.finish.execute({
          actor: 'human',
          retro: { retroId },
          finishMessage: 'A second thought.',
        })

        expect(second.finishedNow).toBe(false)
        expect((await harness.store.finishMessages.findLatest(retroId, revisionN))?.message).toBe(
          'The word that stands.',
        )
        expect(await harness.store.finishMessages.listLatestByRetro(retroId)).toHaveLength(1)
      })

      /** The grain is the round, so the next round gets a word of its own. */
      test('each round carries its own', async () => {
        const { retroId } = await harness.revision(session.id, [{ rid: 'r-one', num: 1 }])
        await harness.decide(retroId, 'r-one', 'approved')
        await harness.app.review.finish.execute({
          actor: 'human',
          retro: { retroId },
          finishMessage: 'Round one.',
        })

        await harness.revision(session.id, [
          { rid: 'r-one', num: 1, problem: 'A rewritten problem statement.' },
        ])
        await harness.decide(retroId, 'r-one', 'approved')
        await harness.app.review.finish.execute({
          actor: 'human',
          retro: { retroId },
          finishMessage: 'Round two.',
        })

        expect(
          (await harness.store.finishMessages.listLatestByRetro(retroId)).map(
            (stored) => `${stored.revisionN}: ${stored.message}`,
          ),
        ).toEqual(['1: Round one.', '2: Round two.'])
      })

      /**
       * It is a human field, so the AI cannot write it — and the refusal is the
       * actor guard that already stood on the first statement of the use case,
       * which is why carrying a message past it is impossible rather than merely
       * unsupported. The browser cannot reach the other side of this: its tRPC
       * context is unconditionally `human`.
       */
      test('the AI actor cannot write one', async () => {
        const { retroId, revisionN } = await aDecidedRound()

        await expect(
          harness.app.review.finish.execute({
            actor: 'ai',
            retro: { retroId },
            finishMessage: 'Filed by the wrong actor.',
          }),
        ).rejects.toBeInstanceOf(ForbiddenActorError)
        expect(await harness.store.finishMessages.findLatest(retroId, revisionN)).toBeUndefined()
        expect(await harness.eventNames()).not.toContain('ReviewFinished')
      })

      /** `revision get --feedback-only` is where the AI reads it (KC-0004). */
      test('reaches the drafting step through the feedback view', async () => {
        const { retroId } = await aDecidedRound()
        await harness.app.review.finish.execute({
          actor: 'human',
          retro: { retroId },
          finishMessage: 'Ship it.',
        })

        const feedback = await harness.app.revisions.feedback.execute({
          actor: 'ai',
          retro: { retroId },
        })

        expect(feedback.finishMessage).toBe('Ship it.')
        // Separately from the comments, as he asked: nothing about it is a thread.
        expect(feedback.threads).toEqual([])
      })

      test('the feedback view says undefined when he left no word', async () => {
        const { retroId } = await aDecidedRound()
        await harness.app.review.finish.execute({ actor: 'human', retro: { retroId } })

        expect(
          (await harness.app.revisions.feedback.execute({ actor: 'ai', retro: { retroId } }))
            .finishMessage,
        ).toBeUndefined()
      })

      /** Each round's word belongs to that round, and `--revision` asks for one. */
      test('the feedback view answers for the revision asked about', async () => {
        const { retroId } = await harness.revision(session.id, [{ rid: 'r-one', num: 1 }])
        await harness.decide(retroId, 'r-one', 'approved')
        await harness.app.review.finish.execute({
          actor: 'human',
          retro: { retroId },
          finishMessage: 'Round one.',
        })
        await harness.revision(session.id, [
          { rid: 'r-one', num: 1, problem: 'A rewritten problem statement.' },
        ])

        expect(
          (
            await harness.app.revisions.feedback.execute({
              actor: 'ai',
              retro: { retroId },
              revision: 1,
            })
          ).finishMessage,
        ).toBe('Round one.')
        expect(
          (await harness.app.revisions.feedback.execute({ actor: 'ai', retro: { retroId } }))
            .finishMessage,
        ).toBeUndefined()
      })
    })

    test('is a NotFound for an unknown retrospective or one with no revision', async () => {
      await expect(
        harness.app.review.finish.execute({ actor: 'human', retro: { retroId: 404 } }),
      ).rejects.toBeInstanceOf(NotFoundError)

      const bare = await harness.store.retrospectives.add({
        sessionId: session.id,
        state: 'open',
        startedAt: harness.clock.iso(),
        finishedAt: undefined,
      })
      await expect(
        harness.app.review.finish.execute({ actor: 'human', retro: { retroId: bare.id } }),
      ).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  /**
   * The AI's close to export (retro 4 `r-one-finish-button`). Every guard on it
   * is mechanical, because the thing it must never do — file the human's ask as
   * an outcome — is exactly what a judgment call would eventually do.
   */
  describe('close', () => {
    async function finishedRound(records: readonly Partial<RecordInput>[] = [{}]) {
      const { retroId, revision } = await harness.revision(session.id, records)
      for (const record of revision.records) await harness.decide(retroId, record.rid, 'approved')
      await harness.app.review.finish.execute({ actor: 'human', retro: { retroId } })
      return { retroId, revision }
    }

    test('takes the retrospective to finished, with an event of its own', async () => {
      const { retroId } = await finishedRound([{}, {}])

      const result = await harness.app.review.close.execute({ actor: 'ai', retro: { retroId } })

      expect(result.retrospective.state).toBe('finished')
      expect(result.retrospective.finishedAt).toBe(harness.clock.iso())
      expect(result.revisionN).toBe(1)
      expect((await harness.eventNames()).at(-1)).toBe('ReviewClosed')
    })

    test('refuses while the human has not finished this round', async () => {
      const { retroId, revision } = await harness.revision(session.id)
      await harness.decide(retroId, revision.records[0]?.rid ?? '', 'approved')

      await expect(
        harness.app.review.close.execute({ actor: 'ai', retro: { retroId } }),
      ).rejects.toBeInstanceOf(ConflictError)
      expect((await harness.store.retrospectives.findById(retroId))?.state).toBe('reviewing')
    })

    /**
     * He finished round 1 and the AI answered with revision 2. That old
     * `ReviewFinished` says nothing about the draft now in front of him, and
     * closing on it would end the review he is in the middle of.
     */
    test('refuses on a finish that belongs to an earlier revision', async () => {
      const { retroId } = await finishedRound([{ rid: 'r-one', num: 1 }])
      await harness.revision(session.id, [
        { rid: 'r-one', num: 1, problem: 'A rewritten problem statement.' },
      ])

      await expect(
        harness.app.review.close.execute({ actor: 'ai', retro: { retroId } }),
      ).rejects.toBeInstanceOf(ConflictError)
    })

    /**
     * The window between his finish and the AI's close is a window he can still
     * write in (`finish-lock.service.ts`), so the gate is asked again here.
     */
    test('refuses when a verdict was undone after the finish', async () => {
      const { retroId, revision } = await finishedRound([{}, {}])
      const rid = revision.records[1]?.rid ?? ''
      await harness.decide(retroId, rid, 'pending')

      const failure = harness.app.review.close.execute({ actor: 'ai', retro: { retroId } })
      await expect(failure).rejects.toBeInstanceOf(FinishGateError)
      await failure.catch((error: unknown) => {
        expect((error as FinishGateError).pendingRids).toEqual([rid])
      })
    })

    /**
     * **The way out of the state the previous test lands in**, and the reason it
     * is not a trap: the AI has no verdict to give and cannot press his button,
     * so if the round could only be reopened by a second finish it would wedge.
     *
     * It does not. `ReviewFinished` is an event about a revision, not a latch on
     * a state — an undo does not retract it — so once he rules on the record
     * again, the *original* finish still opens the door and `close` goes through.
     * A second press is not needed, and would be absorbed if he made one (the
     * once-per-round rule, `r-request-changes-multi-press`).
     *
     * Written because SKILL.md now tells a cold agent exactly this: ask him to
     * rule on the named records, then retry the close.
     */
    test('closes on the original finish once he rules again, with no second press', async () => {
      const { retroId, revision } = await finishedRound([{}, {}])
      const rid = revision.records[1]?.rid ?? ''
      await harness.decide(retroId, rid, 'pending')
      await expect(
        harness.app.review.close.execute({ actor: 'ai', retro: { retroId } }),
      ).rejects.toBeInstanceOf(FinishGateError)

      await harness.decide(retroId, rid, 'approved')
      const result = await harness.app.review.close.execute({ actor: 'ai', retro: { retroId } })

      expect(result.retrospective.state).toBe('finished')
      const finishes = (await harness.eventNames()).filter((name) => name === 'ReviewFinished')
      expect(finishes).toHaveLength(1)
    })

    /**
     * The other half of the same question: `hold` is a verdict no one may write
     * any more, but a store from before `r-hold-semantics` can hold one — and a
     * record carrying it is **decided**, so it does not block the close. Both
     * gates ask only about `pending` and `revise`.
     */
    test('a legacy hold verdict does not block the close', async () => {
      const { retroId, revision } = await harness.revision(session.id)
      const record = revision.records[0]
      await harness.store.decisions.add({
        retroId,
        rid: record?.rid ?? '',
        version: 1,
        state: 'hold',
        severity: 3,
        solutionLevel: 2,
        selectedSolution: 2,
        involvement: 'pull-request',
        reviewerNote: undefined,
        revisionN: 1,
        contentHash: hashRecordContent(record as RetroRecord),
        decidedAt: harness.clock.iso(),
      })
      await harness.app.review.finish.execute({ actor: 'human', retro: { retroId } })

      const result = await harness.app.review.close.execute({ actor: 'ai', retro: { retroId } })

      expect(result.retrospective.state).toBe('finished')
    })

    /**
     * A `revise` verdict is must-address-in-the-next-revision by its own record
     * (`r-verdict-revise`). Closing over one would file the human's ask as the
     * outcome, so it is refused — by name, so the AI knows what to address.
     */
    test('refuses while a record still asks to be rewritten', async () => {
      const { retroId, revision } = await finishedRound([{}, {}])
      const rid = revision.records[0]?.rid ?? ''
      await harness.decide(retroId, rid, 'revise')

      const failure = harness.app.review.close.execute({ actor: 'ai', retro: { retroId } })
      await expect(failure).rejects.toBeInstanceOf(ConflictError)
      await failure.catch((error: unknown) => {
        expect((error as Error).message).toContain(rid)
      })
      expect((await harness.store.retrospectives.findById(retroId))?.state).toBe('reviewing')
    })

    test('refuses to close a retrospective that is already closed', async () => {
      const { retroId } = await finishedRound()
      await harness.app.review.close.execute({ actor: 'ai', retro: { retroId } })

      await expect(
        harness.app.review.close.execute({ actor: 'ai', retro: { retroId } }),
      ).rejects.toBeInstanceOf(ConflictError)
    })

    /**
     * The actor rule, from the side that matters here: closing is the AI's
     * mechanical act, and the human's client — the browser, whose tRPC context
     * is unconditionally `human` — cannot reach it.
     */
    test('is closed to the human actor', async () => {
      const { retroId } = await finishedRound()

      await expect(
        harness.app.review.close.execute({ actor: 'human', retro: { retroId } }),
      ).rejects.toBeInstanceOf(ForbiddenActorError)
    })

    test('is a NotFound for an unknown retrospective', async () => {
      await expect(
        harness.app.review.close.execute({ actor: 'ai', retro: { retroId: 404 } }),
      ).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  /**
   * Read-only after `finished`, with **no exceptions** — `finish-lock.service.ts`.
   *
   * This enumeration lived in `holds.test.ts` and moved here when retro 4
   * `r-remove-hold` deleted that file. It was written to prove the exception was
   * exactly two procedures wide: `holds.set` and `holds.clear` stayed reachable
   * on a finished review because the solving side read a hold long after the
   * review closed (retro 3 `r-hold-semantics`). The feature is gone, so the
   * exception is gone with it, and this list is now the whole set of human
   * writes — one place that names them all, rather than three tests that each
   * forgot the fourth.
   *
   * What makes a retrospective finished is the AI's close, not the human's
   * finish (retro 4 `r-one-finish-button`) — so the arrangement below runs the
   * whole of the end of the loop, and `review.requestChanges` has left the list
   * because it has left the product.
   */
  describe('after the review is closed', () => {
    test('no human write is accepted at all', async () => {
      const { retroId, revision } = await harness.revision(session.id, [{}, {}])
      const rid = revision.records[0]?.rid ?? ''
      // Opened before the close, because resolving needs a thread to resolve and
      // opening one afterwards is itself refused.
      const { thread } = await harness.app.threads.addComment.execute({
        actor: 'human',
        retro: { retroId },
        target: { kind: 'review' },
        text: 'Something to settle later.',
      })
      for (const record of revision.records) await harness.decide(retroId, record.rid, 'approved')
      await harness.app.review.finish.execute({ actor: 'human', retro: { retroId } })
      await harness.app.review.close.execute({ actor: 'ai', retro: { retroId } })

      // Thunks rather than promises: started eagerly, each rejection would be
      // unhandled until the loop reached it.
      const refused: readonly [string, () => Promise<unknown>][] = [
        [
          'decisions.record',
          () =>
            harness.app.decisions.record.execute({
              actor: 'human',
              retro: { retroId },
              rid,
              decision: { state: 'declined' },
            }),
        ],
        [
          'threads.addComment',
          () =>
            harness.app.threads.addComment.execute({
              actor: 'human',
              retro: { retroId },
              target: { kind: 'record', rid, section: 'problem' },
              text: 'Too late.',
            }),
        ],
        [
          'threads.resolve',
          () =>
            harness.app.threads.resolve.execute({
              actor: 'human',
              threadId: thread.id,
              resolved: true,
            }),
        ],
        [
          'review.finish',
          () => harness.app.review.finish.execute({ actor: 'human', retro: { retroId } }),
        ],
      ]

      for (const [name, attempt] of refused) {
        await expect(attempt(), `${name} wrote to a finished retrospective`).rejects.toBeInstanceOf(
          ConflictError,
        )
      }
    })

    /**
     * **The four writes that are deliberately still open, and the list above is
     * still complete** — because none of them is a write on the *review*.
     *
     * They are the exceptions `finish-lock.service.ts` anticipated when it
     * recorded the two `holds` procedures that held the same position in retro
     * 3: a feature the solving side reads long after the review closed cannot be
     * locked by the review closing. Each was asked for **because** the retro is
     * closed:
     *
     * - the lifecycle — *"even after a retro has been closed, we should be able
     *   to attach metadata to issues so that we can manage their life cycle"*;
     * - the label and the attribute value — the owner's second usage archetype,
     *   where a team reaches agreement here and manages the work elsewhere:
     *   *"on completion of the retro they may actually want to move everything
     *   into GitHub right away … they could actually put a label that says
     *   'migrated'"*. That act happens after the close by construction, so a
     *   lock over it would have made the feature unreachable in the one case it
     *   was designed for.
     * - the relation, session 11 — *"both actors can relate records … so that AI
     *   can easily find past records and build holistic solutions."* This is the
     *   most closed-retro-shaped of the four: the record being related **to** is
     *   normally in a retrospective that closed sessions ago, and a lock over it
     *   would make the feature unreachable in the only case it exists for.
     *
     * None of the four endangers what the lock protects, for the same reason:
     * **none is in the export**, so the document taken from this retrospective
     * reads the same before and after (A8, the session-10 default that keeps
     * labels and attributes out of export v1, and the session-11 default that
     * keeps relations out on exactly this argument — a relation *can* be added
     * after an export was taken, which is precisely why it is not in one).
     *
     * Asserted here rather than only in their own files because this is the file
     * that claims to enumerate the whole set, and a claim about a set is only
     * worth as much as its exceptions being named in the same place.
     */
    test('the lifecycle, a label, a value and a relation are still writable — the deliberate exceptions', async () => {
      const { retroId, revision } = await harness.revision(session.id, [{}, {}])
      const rid = revision.records[0]?.rid ?? ''
      const otherRid = revision.records[1]?.rid ?? ''
      await harness.app.labels.define.execute({ actor: 'human', name: 'migrated' })
      await harness.app.attributes.define.execute({
        actor: 'human',
        name: 'external issue id',
        type: 'url',
      })
      for (const record of revision.records) await harness.decide(retroId, record.rid, 'approved')
      await harness.app.review.finish.execute({ actor: 'human', retro: { retroId } })
      await harness.app.review.close.execute({ actor: 'ai', retro: { retroId } })

      const resolved = await harness.app.records.setLifecycle.execute({
        actor: 'ai',
        retro: { retroId },
        rid,
        status: 'resolved',
        refs: ['a1b2c3d'],
      })
      expect(resolved.lifecycle.status).toBe('resolved')

      // The migrate story, end to end, on a retrospective that is already
      // closed: the label that says where it went, and the reference that says
      // where exactly (the user's own convention — the system pairs nothing).
      const labelled = await harness.app.labels.apply.execute({
        actor: 'human',
        retro: { retroId },
        rid,
        label: { labelName: 'migrated' },
        applied: true,
      })
      const valued = await harness.app.attributes.set.execute({
        actor: 'human',
        retro: { retroId },
        rid,
        attribute: { attributeName: 'external issue id' },
        value: 'https://github.com/o/r/issues/91',
      })

      expect(labelled.labels.map((one) => one.name)).toEqual(['migrated'])
      expect(valued.values.map((one) => one.value)).toEqual(['https://github.com/o/r/issues/91'])

      /**
       * The fourth exception, by the actor the feature was asked for: the AI
       * relating one closed retrospective's record to another. Both ends are in
       * this retrospective only because the harness files one retrospective —
       * the rule under test is the lock, and the lock is per retrospective, so
       * a relation whose far end were elsewhere would exercise *less* of it.
       */
      const from = await harness.store.recordIds.findByRecord(retroId, rid)
      const to = await harness.store.recordIds.findByRecord(retroId, otherRid)
      const related = await harness.app.records.relate.execute({
        actor: 'ai',
        fromId: from?.id ?? 0,
        toId: to?.id ?? 0,
        related: true,
        how: 'the same lock, found again',
      })

      expect(related.relations.map((one) => [one.globalId, one.how, one.direction])).toEqual([
        [to?.id ?? 0, 'the same lock, found again', 'outgoing'],
      ])
    })
  })
})
