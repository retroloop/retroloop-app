import { beforeEach, describe, expect, test } from 'bun:test'
import type { RecordInput } from '#application/schemas/revision-input.schema'
import type { CreateRevisionOutput } from '#application/use-cases/revisions/create-revision.use-case'
import { ConflictError } from '#domain/errors/conflict.error'
import { NotFoundError } from '#domain/errors/not-found.error'
import { ValidationError } from '#domain/errors/validation.error'
import type { Session } from '#domain/models/session.model'
import { aRevisionInput } from '../support/fixtures'
import { createHarness, type Harness } from '../support/harness'

describe('revisions', () => {
  let harness: Harness
  let session: Session

  beforeEach(async () => {
    harness = createHarness()
    session = await harness.session()
  })

  /**
   * The next round: the human finishes the one on the table, then the AI files.
   *
   * Since `r-revision-sneaks-past-review` that is the only way a second
   * revision lands, so a test whose subject is something else — identity
   * stability, the global sequence, reading an older revision back — runs the
   * rhythm rather than filing over a round nobody put down.
   */
  const nextRevision = async (
    retroId: number,
    records?: readonly Partial<RecordInput>[],
  ): Promise<CreateRevisionOutput> => {
    await harness.finishRound(retroId)
    return harness.revision(session.id, records)
  }

  describe('create', () => {
    test('opens a retrospective, writes revision 1 and moves it to reviewing', async () => {
      const { retroId, retroStarted, revision } = await harness.revision(session.id, [{}, {}])

      expect(retroStarted).toBe(true)
      expect(revision.n).toBe(1)
      expect(revision.records).toHaveLength(2)
      expect(revision.createdAt).toBe(harness.clock.iso())
      expect((await harness.store.retrospectives.findById(retroId))?.state).toBe('reviewing')
      expect(await harness.eventNames()).toEqual([
        'SessionCreated',
        'RetrospectiveStarted',
        'RevisionCreated',
      ])
    })

    /**
     * The retro's name rides on the draft that proposed it, and it is
     * stored trimmed exactly as the schema parsed it — the CLI hands the payload
     * over untouched, so this is the only place the title is normalised.
     */
    test('stores the title the draft proposed, trimmed, and none when it proposed none', async () => {
      const titled = await harness.app.revisions.create.execute({
        actor: 'ai',
        session: session.id,
        revision: { ...aRevisionInput(), title: '  The lock that outlived its process  ' },
      })
      await harness.finishRound(titled.retroId)
      const untitled = await harness.revision(session.id)

      expect(titled.revision.title).toBe('The lock that outlived its process')
      expect(untitled.revision.title).toBeUndefined()
    })

    test('orders the records by their display number', async () => {
      const { revision } = await harness.app.revisions.create.execute({
        actor: 'ai',
        session: session.id,
        revision: {
          records: [
            ...aRevisionInput([{ rid: 'r-second', num: 2 }]).records,
            ...aRevisionInput([{ rid: 'r-first', num: 1 }]).records,
          ],
        },
      })

      expect(revision.records.map((record) => record.rid)).toEqual(['r-first', 'r-second'])
    })

    test('adds later revisions to the same retrospective — one open at a time', async () => {
      const first = await harness.revision(session.id)
      const second = await nextRevision(first.retroId)

      expect(second.retroId).toBe(first.retroId)
      expect(second.retroStarted).toBe(false)
      expect(second.revision.n).toBe(2)
      // The human's half of round 1 sits between the two filings now, which is
      // the loop's rhythm made mandatory: decide, Finish, then the next
      // draft answers it.
      expect(await harness.eventNames()).toEqual([
        'SessionCreated',
        'RetrospectiveStarted',
        'RevisionCreated',
        'DecisionRecorded',
        'ReviewFinished',
        'RevisionCreated',
      ])
    })

    test('starts a new retrospective once the last one is finished', async () => {
      const first = await harness.revision(session.id)
      await harness.decide(first.retroId, first.revision.records[0]?.rid ?? '', 'approved')
      await harness.closeReview(first.retroId)

      const second = await harness.revision(session.id)

      expect(second.retroStarted).toBe(true)
      expect(second.retroId).not.toBe(first.retroId)
      // Revision numbering restarts per retrospective.
      expect(second.revision.n).toBe(1)
    })

    /**
     * Identity is minted **per retrospective**, not per session: the stability
     * check reads the revisions of *this* retrospective, so a second one on the
     * same session starts from an empty slate. A cold agent needs to know this
     * before it goes looking for the highest number ever used — the answer is
     * scoped to the retrospective it is filing into, and `r-stale-lock` can
     * legitimately be record 1 of two different retrospectives.
     */
    test('a second retrospective mints identity fresh — a used rid, at a new number', async () => {
      const first = await harness.revision(session.id, [
        { rid: 'r-stale-lock', num: 1 },
        { rid: 'r-slow-tests', num: 2 },
      ])
      for (const record of first.revision.records) {
        await harness.decide(first.retroId, record.rid, 'approved')
      }
      await harness.closeReview(first.retroId)

      // `r-slow-tests` was record 2 over there. Here it is record 1 — which the
      // session-wide reading of the rule would refuse as a renumbering, and the
      // per-retrospective reading (the real one) allows.
      const second = await harness.revision(session.id, [{ rid: 'r-slow-tests', num: 1 }])

      expect(second.retroId).not.toBe(first.retroId)
      expect(second.revision.records[0]?.num).toBe(1)
    })

    /**
     * **`r-revision-sneaks-past-review`** — a revision could be sent while the
     * human had not finished reviewing the round, which should not be allowed:
     * the human should not spend time on a review while the AI sneaks in a new
     * revision underneath it.
     *
     * It happened twice in one retrospective. Both filings were legal: `revision
     * create` guarded identity and races, and the review's state was never an
     * input to it — the file-review-finish-file rhythm lived in SKILL.md prose,
     * which binds nobody at the API. The cost is real: a replaced round can flip a
     * record the reviewer has already decided back to pending, so the time was
     * spent on a moving target with no signal that it moved.
     */
    describe('while the human is still reviewing the round', () => {
      test('refuses the next revision, and leaves the round exactly as it was', async () => {
        const first = await harness.revision(session.id, [{}, {}])

        await expect(harness.revision(session.id)).rejects.toBeInstanceOf(ConflictError)

        // Nothing landed: the round the human is on is still revision 1, with
        // its two records, and no event claims otherwise.
        const latest = await harness.store.revisions.findLatestByRetro(first.retroId)
        expect(latest?.n).toBe(1)
        expect(latest?.records).toHaveLength(2)
        expect(await harness.eventNames()).toEqual([
          'SessionCreated',
          'RetrospectiveStarted',
          'RevisionCreated',
        ])
      })

      /**
       * The refusal has to name the way out, or the AI retries the thing that
       * was just refused. The designed escape was already there: mark the record
       * that needs rewriting `revise`, decide the rest, press Finish — and the
       * rewrite lands as the next round.
       */
      test('the refusal names the revise verdict and the Finish it waits on', async () => {
        await harness.revision(session.id)

        const refusal = await harness.revision(session.id).catch((error: unknown) => error)

        expect(refusal).toBeInstanceOf(ConflictError)
        const message = (refusal as Error).message
        expect(message).toContain('revise')
        expect(message).toContain('Finish')
      })

      test('accepts it once the human has finished the round', async () => {
        const first = await harness.revision(session.id)
        await harness.finishRound(first.retroId)

        const second = await harness.revision(session.id)

        expect(second.retroId).toBe(first.retroId)
        expect(second.revision.n).toBe(2)
      })

      /**
       * Every round after the first is gated too, not just the second: the point
       * is the rhythm, and a gate that let revision 3 replace an unfinished
       * revision 2 would have allowed exactly the second of the two filings
       * this gate exists to refuse.
       */
      test('gates every later round, not only the second', async () => {
        const first = await harness.revision(session.id)
        await harness.finishRound(first.retroId)
        await harness.revision(session.id)

        await expect(harness.revision(session.id)).rejects.toBeInstanceOf(ConflictError)
      })

      /**
       * The first revision of a retrospective has no round to replace, so it is
       * never gated — including the first of a *new* retrospective opened after
       * the previous one closed, which is the ordinary start of every session.
       */
      test('never gates the first revision of a retrospective', async () => {
        const first = await harness.revision(session.id)
        await harness.decide(first.retroId, first.revision.records[0]?.rid ?? '', 'approved')
        await harness.closeReview(first.retroId)

        const second = await harness.revision(session.id)

        expect(second.retroStarted).toBe(true)
        expect(second.revision.n).toBe(1)
      })

      /**
       * The trade the record states rather than hides: a draft correction seconds
       * after filing waits for a finish too. That is the price of the guarantee
       * that review time is never spent on a moving target, and there is no flag
       * to buy it back — an override would recreate the sneak.
       */
      test('a correction filed seconds later waits for the finish, like anything else', async () => {
        const first = await harness.revision(session.id, [{ rid: 'r-typo', num: 1 }])

        await expect(
          harness.app.revisions.create.execute({
            actor: 'ai',
            session: session.id,
            revision: aRevisionInput([{ rid: 'r-typo', num: 1, title: 'Fixed the typo' }]),
          }),
        ).rejects.toBeInstanceOf(ConflictError)

        expect((await harness.store.revisions.findLatestByRetro(first.retroId))?.n).toBe(1)
      })
    })

    test('refuses a stale --expect-revision and leaves nothing behind', async () => {
      await expect(
        harness.app.revisions.create.execute({
          actor: 'ai',
          session: session.id,
          revision: aRevisionInput(),
          expectRevision: 2,
        }),
      ).rejects.toBeInstanceOf(ConflictError)

      // The whole unit of work rolled back: no orphan retrospective, no event.
      expect(await harness.store.retrospectives.listBySession(session.id)).toEqual([])
      expect(await harness.eventNames()).toEqual(['SessionCreated'])
    })

    test('accepts a matching --expect-revision', async () => {
      const first = await harness.revision(session.id)
      await harness.finishRound(first.retroId)
      const second = await harness.app.revisions.create.execute({
        actor: 'ai',
        session: session.id,
        revision: aRevisionInput(),
        expectRevision: 2,
      })

      expect(second.revision.n).toBe(2)
    })

    test('rejects a draft that does not match the schema', async () => {
      await expect(
        harness.app.revisions.create.execute({
          actor: 'ai',
          session: session.id,
          revision: { records: [{ rid: 'r-one' }] },
        }),
      ).rejects.toBeInstanceOf(ValidationError)
    })

    test('is a NotFound for an unknown session', async () => {
      await expect(
        harness.app.revisions.create.execute({
          actor: 'ai',
          session: 404,
          revision: aRevisionInput(),
        }),
      ).rejects.toBeInstanceOf(NotFoundError)
    })

    describe('record identity across revisions', () => {
      test('refuses to renumber a record', async () => {
        const { retroId } = await harness.revision(session.id, [{ rid: 'r-one', num: 1 }])
        await harness.finishRound(retroId)

        await expect(
          harness.revision(session.id, [
            { rid: 'r-one', num: 2 },
            { rid: 'r-two', num: 1 },
          ]),
        ).rejects.toBeInstanceOf(ValidationError)
      })

      test('refuses to hand a used number to a different record', async () => {
        const { retroId } = await harness.revision(session.id, [{ rid: 'r-one', num: 1 }])
        await harness.finishRound(retroId)

        await expect(
          harness.revision(session.id, [{ rid: 'r-different', num: 1 }]),
        ).rejects.toBeInstanceOf(ValidationError)
      })

      test('refuses numbers that are not dense from 1', async () => {
        await expect(
          harness.revision(session.id, [{ rid: 'r-one', num: 2 }]),
        ).rejects.toBeInstanceOf(ValidationError)

        const { retroId } = await harness.revision(session.id, [{ rid: 'r-one', num: 1 }])
        await harness.finishRound(retroId)
        await expect(
          harness.revision(session.id, [
            { rid: 'r-one', num: 1 },
            { rid: 'r-three', num: 3 },
          ]),
        ).rejects.toBeInstanceOf(ValidationError)
      })

      test('lets a record keep its number while others are added', async () => {
        const first = await harness.revision(session.id, [{ rid: 'r-one', num: 1 }])
        const second = await nextRevision(first.retroId, [
          { rid: 'r-one', num: 1 },
          { rid: 'r-two', num: 2 },
        ])

        expect(second.revision.records.map((record) => record.num)).toEqual([1, 2])
      })

      test('lets the AI drop a record without breaking the numbering', async () => {
        const first = await harness.revision(session.id, [
          { rid: 'r-one', num: 1 },
          { rid: 'r-two', num: 2 },
        ])

        const second = await nextRevision(first.retroId, [{ rid: 'r-two', num: 2 }])

        expect(second.revision.records.map((record) => record.rid)).toEqual(['r-two'])
      })
    })

    /**
     * The third name a record has, and the only one the AI does not author
     * (`record-id.model.ts`): a global sequence across every retrospective,
     * rather than a number scoped to the one that filed the record.
     */
    describe('the global number', () => {
      const minted = async (retroId: number) =>
        (await harness.store.recordIds.listByRetro(retroId)).map((row) => [row.id, row.rid])

      test('is minted for every record the first draft introduces, in reading order', async () => {
        // Filed out of order on purpose: the number follows `num`, which is the
        // order the reviewer reads them in, not the order the draft listed them.
        const { retroId } = await harness.revision(session.id, [
          { rid: 'r-second', num: 2 },
          { rid: 'r-first', num: 1 },
        ])

        expect(await minted(retroId)).toEqual([
          [1, 'r-first'],
          [2, 'r-second'],
        ])
      })

      test('is minted once: a record that appears again keeps the number it has', async () => {
        const { retroId } = await harness.revision(session.id, [{ rid: 'r-one', num: 1 }])
        await nextRevision(retroId, [
          { rid: 'r-one', num: 1, problem: 'Rewritten in the second draft.' },
          { rid: 'r-two', num: 2 },
        ])

        expect(await minted(retroId)).toEqual([
          [1, 'r-one'],
          [2, 'r-two'],
        ])
      })

      /**
       * A record withdrawn from a later draft keeps its number, and the number is
       * not handed on. The rid could come back in a third draft — identity
       * stability allows exactly that — and it would come back as the same
       * record.
       */
      test('is not returned to the sequence when a later draft drops the record', async () => {
        const { retroId } = await harness.revision(session.id, [
          { rid: 'r-one', num: 1 },
          { rid: 'r-two', num: 2 },
        ])
        await nextRevision(retroId, [{ rid: 'r-one', num: 1 }])
        await nextRevision(retroId, [
          { rid: 'r-one', num: 1 },
          { rid: 'r-three', num: 3 },
        ])

        expect(await minted(retroId)).toEqual([
          [1, 'r-one'],
          [2, 'r-two'],
          [3, 'r-three'],
        ])
      })

      /**
       * The whole point of the change: a second retrospective does not start
       * counting again. `num` does — both retrospectives hold a record 1 — and
       * that per-retro reset is exactly what made the old numbering confusing.
       */
      test('runs on across retrospectives, where the per-retro number restarts', async () => {
        const first = await harness.revision(session.id, [
          { rid: 'r-one', num: 1 },
          { rid: 'r-two', num: 2 },
        ])
        await harness.decide(first.retroId, 'r-one', 'approved')
        await harness.decide(first.retroId, 'r-two', 'approved')
        await harness.closeReview(first.retroId)

        const second = await harness.revision(session.id, [{ rid: 'r-one', num: 1 }])

        expect(second.retroId).not.toBe(first.retroId)
        expect(second.revision.records.map((record) => record.num)).toEqual([1])
        expect(await minted(second.retroId)).toEqual([[3, 'r-one']])
      })

      /**
       * **It is not in the draft, and that is the promise.** `revision get
       * --content` hands back what was submitted so a lost draft can be rebuilt
       * from it by wrapping it in `{ "records": [...] }` (SKILL.md); a key the
       * input schema does not accept would break that, and would only ever
       * surface as an exit 2 in somebody else's session.
       */
      test('is nowhere in the stored draft', async () => {
        const { retroId, revision } = await harness.revision(session.id, [{ rid: 'r-one', num: 1 }])

        expect(await minted(retroId)).toEqual([[1, 'r-one']])
        expect(JSON.stringify(revision.records)).not.toContain('globalId')
        expect(Object.keys(revision.records[0] ?? {})).not.toContain('globalId')
      })

      /** One unit of work: a refused draft leaves no number spoken for. */
      test('is not consumed by a draft the identity check refuses', async () => {
        const { retroId } = await harness.revision(session.id, [{ rid: 'r-one', num: 1 }])
        await harness.finishRound(retroId)

        await expect(
          harness.revision(session.id, [
            { rid: 'r-one', num: 1 },
            { rid: 'r-two', num: 3 },
          ]),
        ).rejects.toBeInstanceOf(ValidationError)

        await harness.revision(session.id, [
          { rid: 'r-one', num: 1 },
          { rid: 'r-two', num: 2 },
        ])
        expect(await minted(retroId)).toEqual([
          [1, 'r-one'],
          [2, 'r-two'],
        ])
      })
    })
  })

  describe('get', () => {
    test('returns the revision with every piece of human feedback on it', async () => {
      const { retroId, revision } = await harness.revision(session.id, [{}, {}])
      const rid = revision.records[0]?.rid ?? ''
      await harness.decide(retroId, rid, 'approved')
      await harness.app.threads.addComment.execute({
        actor: 'human',
        retro: { retroId },
        target: { kind: 'record', rid, section: 'problem' },
        text: 'The impact is understated.',
      })

      const view = await harness.app.revisions.get.execute({ actor: 'ai', retro: { retroId } })

      expect(view.revision.n).toBe(1)
      expect(view.revision.records).toBe(2)
      expect(view.records).toHaveLength(2)
      expect(view.records[0]?.decision.state).toBe('approved')
      expect(view.records[1]?.decision.state).toBe('pending')
      expect(view.threads).toHaveLength(1)
    })

    test('reads an earlier revision by number, and the latest by default', async () => {
      const { retroId } = await harness.revision(session.id, [{ rid: 'r-one', num: 1 }])
      await nextRevision(retroId, [
        { rid: 'r-one', num: 1 },
        { rid: 'r-two', num: 2 },
      ])

      expect(
        (await harness.app.revisions.get.execute({ actor: 'ai', retro: { retroId }, revision: 1 }))
          .records,
      ).toHaveLength(1)
      expect(
        (await harness.app.revisions.get.execute({ actor: 'ai', retro: { retroId } })).records,
      ).toHaveLength(2)
    })

    test('resolves a session reference to its active retrospective', async () => {
      const { retroId } = await harness.revision(session.id)

      const view = await harness.app.revisions.get.execute({
        actor: 'ai',
        retro: { session: session.id },
      })

      expect(view.retrospective.id).toBe(retroId)
    })

    test('is a NotFound for an unknown retrospective or revision', async () => {
      const { retroId } = await harness.revision(session.id)

      await expect(
        harness.app.revisions.get.execute({ actor: 'ai', retro: { retroId: 404 } }),
      ).rejects.toBeInstanceOf(NotFoundError)
      await expect(
        harness.app.revisions.get.execute({ actor: 'ai', retro: { retroId }, revision: 9 }),
      ).rejects.toBeInstanceOf(NotFoundError)
      await expect(
        harness.app.revisions.get.execute({ actor: 'ai', retro: { session: 404 } }),
      ).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  describe('get --feedback-only', () => {
    test('returns verdicts and conversation, and no narrative at all', async () => {
      const { retroId, revision } = await harness.revision(session.id)
      const rid = revision.records[0]?.rid ?? ''
      await harness.app.decisions.record.execute({
        actor: 'human',
        retro: { retroId },
        rid,
        decision: { state: 'approved', reviewerNote: 'Do this one first.' },
      })

      const feedback = await harness.app.revisions.feedback.execute({
        actor: 'ai',
        retro: { retroId },
      })

      expect(feedback.records).toEqual([
        {
          rid,
          num: 1,
          state: 'approved',
          decidedOnRevision: 1,
          contentChangedSince: undefined,
          severity: 3,
          solutionLevel: 2,
          selectedSolution: 2,
          involvement: 'pull-request',
          reviewerNote: 'Do this one first.',
        },
      ])
      expect(JSON.stringify(feedback)).not.toContain('five-whys')
      // The verdict says *which* solution, never what the solution said.
      expect(JSON.stringify(feedback)).not.toContain('footprint')
      expect(JSON.stringify(feedback)).not.toContain('bullets')
    })

    test('carries the dials the human turned, not the ones the AI proposed', async () => {
      const { retroId, revision } = await harness.revision(session.id)
      const rid = revision.records[0]?.rid ?? ''
      await harness.app.decisions.record.execute({
        actor: 'human',
        retro: { retroId },
        rid,
        decision: {
          state: 'approved',
          severity: 1,
          selectedSolution: 1,
          involvement: 'interactive',
        },
      })

      const feedback = await harness.app.revisions.feedback.execute({
        actor: 'ai',
        retro: { retroId },
      })

      expect(feedback.records[0]).toMatchObject({
        state: 'approved',
        severity: 1,
        selectedSolution: 1,
        solutionLevel: 1,
        involvement: 'interactive',
      })
    })

    /**
     * The projection the AI reads before drafting revision n+1 and the document
     * the export hands downstream are two views of one review. If they disagree
     * about a record's dials, one of them is lying about what the human decided —
     * so they are held to the same `effectiveDecision`, here and forever.
     */
    test('reports the same dials the export does for the same record', async () => {
      const { retroId } = await harness.revision(session.id)
      const rid = 'r-record-1'
      await harness.app.decisions.record.execute({
        actor: 'human',
        retro: { retroId },
        rid,
        decision: {
          state: 'approved',
          severity: 1,
          selectedSolution: 1,
          involvement: 'interactive',
        },
      })

      const feedback = await harness.app.revisions.feedback.execute({
        actor: 'ai',
        retro: { retroId },
      })
      await harness.closeReview(retroId)
      const { export: document } = await harness.app.exports.retrospective.execute({
        actor: 'ai',
        retro: { retroId },
      })

      const verdict = feedback.records.find((record) => record.rid === rid)
      const exported = document.records.find((record) => record.rid === rid)
      expect(exported).toBeDefined()
      expect({
        state: verdict?.state,
        severity: verdict?.severity,
        solutionLevel: verdict?.solutionLevel,
        selectedSolution: verdict?.selectedSolution,
        involvement: verdict?.involvement,
      }).toEqual({
        state: exported?.state,
        severity: exported?.severity,
        solutionLevel: exported?.solutionLevel,
        selectedSolution: exported?.selectedSolution,
        involvement: exported?.involvement,
      })
    })

    test('is a NotFound for an unknown retrospective', async () => {
      await expect(
        harness.app.revisions.feedback.execute({ actor: 'ai', retro: { retroId: 404 } }),
      ).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  describe('list', () => {
    test('lists the retrospective’s revisions with their record counts', async () => {
      const { retroId } = await harness.revision(session.id, [{ rid: 'r-one', num: 1 }])
      await nextRevision(retroId, [
        { rid: 'r-one', num: 1 },
        { rid: 'r-two', num: 2 },
      ])

      const { revisions } = await harness.app.revisions.list.execute({
        actor: 'ai',
        retro: { retroId },
      })

      expect(revisions.map((revision) => [revision.n, revision.records])).toEqual([
        [1, 1],
        [2, 2],
      ])
    })

    /**
     * **Finished, per round.**
     *
     * `retrospective.finishedAt` is the retro's own close, written once at the
     * very end, so a reader asking "has the human put down the round I am
     * showing?" got null through every round but the last. There is no `review.status`
     * procedure to ask instead, so the fact rides on the revision it describes.
     *
     * Both directions in one test, because either alone passes on a broken fix:
     * a field hard-wired to null satisfies "absent before", and one hard-wired to
     * a timestamp satisfies "present after".
     */
    test('says when each round was finished, and nothing for one still open', async () => {
      const { retroId } = await harness.revision(session.id, [{ rid: 'r-one', num: 1 }])

      expect(
        (
          await harness.app.revisions.list.execute({ actor: 'ai', retro: { retroId } })
        ).revisions.map((revision) => revision.finishedAt),
      ).toEqual([undefined])

      const finishedAt = harness.clock.iso()
      await harness.finishRound(retroId)
      harness.clock.advance(60 * 60 * 1000)
      await harness.revision(session.id, [{ rid: 'r-one', num: 1 }])

      // Round 1 carries the moment he finished it; round 2 is the one on the
      // table and carries nothing. The retrospective itself is still unfinished,
      // which is exactly the case the old reading got wrong.
      expect(
        (
          await harness.app.revisions.list.execute({ actor: 'ai', retro: { retroId } })
        ).revisions.map((revision) => [revision.n, revision.finishedAt]),
      ).toEqual([
        [1, finishedAt],
        [2, undefined],
      ])
      expect((await harness.store.retrospectives.findById(retroId))?.finishedAt).toBeUndefined()
    })

    test('is a NotFound for an unknown retrospective', async () => {
      await expect(
        harness.app.revisions.list.execute({ actor: 'ai', retro: { retroId: 404 } }),
      ).rejects.toBeInstanceOf(NotFoundError)
    })
  })
})
