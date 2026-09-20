import { beforeEach, describe, expect, test } from 'bun:test'
import { ConflictError } from '#domain/errors/conflict.error'
import { NotFoundError } from '#domain/errors/not-found.error'
import { ValidationError } from '#domain/errors/validation.error'
import type { Actor } from '#domain/models/actor.model'
import { createHarness, type Harness } from '../support/harness'

/**
 * `RelateRecordsUseCase` — both actors can relate records, each relation
 * carries how-they-relate words, and the relation reads from both sides, so
 * that the AI can easily find past records and build holistic solutions.
 *
 * Four claims run through the whole file, and each has a test that fails without
 * it: **both actors** write, the **words** are part of the act, the relation
 * **reads from both sides** off one stored row, and un-relating is a **row**
 * rather than a delete.
 */
describe('record relations', () => {
  let harness: Harness
  let retroId: number
  let rids: readonly string[]
  /** The global ids of this retrospective's two records — what a relation names. */
  let ids: readonly number[]

  /** A second retrospective, closed, holding the past record the feature is about. */
  let pastRetroId: number
  let pastId: number

  beforeEach(async () => {
    harness = createHarness()
    const session = await harness.session()

    const past = await harness.revision(session.id, [{ rid: 'r-stale-lock' }])
    pastRetroId = past.retroId
    await harness.finishRound(pastRetroId)
    await harness.app.review.close.execute({ actor: 'ai', retro: { retroId: pastRetroId } })
    pastId = (await harness.store.recordIds.findByRecord(pastRetroId, 'r-stale-lock'))?.id ?? 0

    const created = await harness.revision(session.id, [
      { rid: 'r-silent-tailer' },
      { rid: 'r-bullet-responses' },
    ])
    retroId = created.retroId
    rids = created.revision.records.map((record) => record.rid)
    ids = await Promise.all(
      rids.map(async (rid) => (await harness.store.recordIds.findByRecord(retroId, rid))?.id ?? 0),
    )
  })

  const relate = (input: {
    readonly actor?: Actor
    readonly fromId?: number
    readonly toId?: number
    readonly related?: boolean
    readonly how?: string
  }) =>
    harness.app.records.relate.execute({
      actor: input.actor ?? 'ai',
      fromId: input.fromId ?? ids[0] ?? 0,
      toId: input.toId ?? ids[1] ?? 0,
      related: input.related ?? true,
      how: input.how ?? (input.related === false ? undefined : 'supersedes'),
    })

  /** What `records.byId` says about one record's relations, in wire-facing shape. */
  const readFrom = async (id: number) =>
    (await harness.app.records.byId.execute({ actor: 'human', id })).relations

  describe('relating', () => {
    test('writes the first version, with its words and its author', async () => {
      const result = await relate({ how: 'duplicates' })

      expect(result).toMatchObject({ fromId: ids[0], toId: ids[1], version: 1 })
      expect(result.relations).toEqual([
        {
          globalId: ids[1] ?? 0,
          retroId,
          rid: rids[1] ?? '',
          how: 'duplicates',
          direction: 'outgoing',
          actor: 'ai',
          at: harness.clock.iso(),
        },
      ])
    })

    /**
     * **The first clause of the ask.** Every other append-only table in the store
     * is single-writer; this one and `record_lifecycle` are not, and unlike the
     * lifecycle there is no per-act exception here — both actors may take both
     * acts, because he gave them both in one sentence.
     */
    test('both actors may relate, and the row records which', async () => {
      const byAi = await relate({ actor: 'ai', how: 'supersedes' })
      expect(byAi.relations[0]?.actor).toBe('ai')

      const byHuman = await relate({
        actor: 'human',
        fromId: ids[1],
        toId: ids[0],
        how: 'was superseded by',
      })
      // The answer is the second record's whole standing, so it carries the AI's
      // relation as `incoming` and the human's new one as `outgoing` — which is
      // the actor column doing its job on one page.
      expect(byHuman.relations.map((one) => [one.direction, one.actor])).toEqual([
        ['incoming', 'ai'],
        ['outgoing', 'human'],
      ])
    })

    /**
     * **One stored row, read from both ends.** The row is directed as authored
     * and is never mirrored, so what makes the far record's page show it is the
     * read asking about both columns — and the direction is the only thing that
     * differs between the two answers.
     */
    test('reads from both sides off one row, with the direction the only difference', async () => {
      await relate({ how: 'supersedes' })

      expect(await readFrom(ids[0] ?? 0)).toEqual([
        expect.objectContaining({
          globalId: ids[1],
          rid: rids[1],
          how: 'supersedes',
          direction: 'outgoing',
          title: expect.any(String),
        }),
      ])
      expect(await readFrom(ids[1] ?? 0)).toEqual([
        expect.objectContaining({
          globalId: ids[0],
          rid: rids[0],
          how: 'supersedes',
          direction: 'incoming',
        }),
      ])

      // One row in the store for the two answers, which is the claim.
      expect(await harness.store.recordRelations.listLatestForEachPair()).toHaveLength(1)
    })

    /**
     * **The case the feature exists for**, and the one the finish lock has to
     * permit: a record filed today related to one whose retrospective closed.
     */
    test('crosses retrospectives, including a finished one', async () => {
      const result = await relate({ fromId: ids[0], toId: pastId, how: 'the same lock again' })

      expect(result.relations[0]).toEqual({
        globalId: pastId,
        retroId: pastRetroId,
        rid: 'r-stale-lock',
        how: 'the same lock again',
        direction: 'outgoing',
        actor: 'ai',
        at: harness.clock.iso(),
      })
      // And the closed retrospective's record shows it, which is what "find past
      // records" means from the other end.
      expect(await readFrom(pastId)).toEqual([
        expect.objectContaining({ globalId: ids[0], direction: 'incoming' }),
      ])
    })

    /**
     * `(#5, #12)` and `(#12, #5)` are two statements with two version sequences.
     * Refusing the second would be the use case deciding relations are symmetric
     * when the words on them are what say whether they are.
     */
    test('the relation the other way round is a second row, not a conflict', async () => {
      await relate({ fromId: ids[0], toId: ids[1], how: 'supersedes' })
      const back = await relate({ fromId: ids[1], toId: ids[0], how: 'was superseded by' })

      expect(back.version).toBe(1)
      expect(await readFrom(ids[0] ?? 0)).toEqual([
        expect.objectContaining({ how: 'supersedes', direction: 'outgoing' }),
        expect.objectContaining({ how: 'was superseded by', direction: 'incoming' }),
      ])
    })

    test('appends one event per act, scoped to the record the act was taken from', async () => {
      await relate({ how: 'supersedes' })
      await relate({ related: false })

      expect(await harness.eventNames()).toContain('RecordRelated')
      expect(await harness.eventNames()).toContain('RecordUnrelated')

      const written = (await harness.store.events.list({})).filter(
        (event) => event.name.startsWith('RecordRelat') || event.name === 'RecordUnrelated',
      )
      expect(written.map((event) => [event.name, event.retroId, event.rid])).toEqual([
        ['RecordRelated', retroId, rids[0] ?? ''],
        ['RecordUnrelated', retroId, rids[0] ?? ''],
      ])
    })
  })

  describe('what it refuses', () => {
    test('a record related to itself', async () => {
      await expect(relate({ fromId: ids[0], toId: ids[0] })).rejects.toBeInstanceOf(ValidationError)
      expect(await harness.store.recordRelations.listLatestForEachPair()).toEqual([])
    })

    test('a global id nothing was minted for, on either side', async () => {
      await expect(relate({ fromId: 404 })).rejects.toBeInstanceOf(NotFoundError)
      await expect(relate({ toId: 404 })).rejects.toBeInstanceOf(NotFoundError)
    })

    /**
     * Everything listable is relatable and everything relatable is listable —
     * the rule `ApplyLabelUseCase` applies to the one record it touches, applied
     * here to each of two.
     */
    test('a record a later draft withdrew', async () => {
      const sessionId = (await harness.store.retrospectives.findById(retroId))?.sessionId ?? 0
      await harness.finishRound(retroId)
      // A second draft that carries only the first record: the second is
      // withdrawn, keeps its number and its history, and is no longer part of the
      // retrospective's outcome.
      await harness.revision(sessionId, [{ rid: rids[0] ?? '' }])

      await expect(relate({ fromId: ids[0], toId: ids[1] })).rejects.toBeInstanceOf(NotFoundError)
      await expect(relate({ fromId: ids[1], toId: ids[0] })).rejects.toBeInstanceOf(NotFoundError)
    })

    /** *"Each relation carries how-they-relate words"* — required, not offered. */
    test('a relation with no words, or with empty ones', async () => {
      await expect(
        harness.app.records.relate.execute({
          actor: 'ai',
          fromId: ids[0] ?? 0,
          toId: ids[1] ?? 0,
          related: true,
        }),
      ).rejects.toBeInstanceOf(ValidationError)
      await expect(relate({ how: '   ' })).rejects.toBeInstanceOf(ValidationError)
    })

    /**
     * Words on the way out are refused rather than dropped: a dropped field is a
     * caller who thinks they said something they did not, and the un-relate row
     * carries the words of the relation it takes off.
     */
    test('words on an un-relate', async () => {
      await relate({ how: 'supersedes' })

      await expect(
        harness.app.records.relate.execute({
          actor: 'human',
          fromId: ids[0] ?? 0,
          toId: ids[1] ?? 0,
          related: false,
          how: 'actually duplicates',
        }),
      ).rejects.toBeInstanceOf(ValidationError)
    })

    /** A no-op is a caller who believes the store says something it does not. */
    test('relating a pair that already stands, and un-relating one that does not', async () => {
      await expect(relate({ related: false })).rejects.toBeInstanceOf(ConflictError)

      await relate({ how: 'supersedes' })
      await expect(relate({ how: 'supersedes again' })).rejects.toBeInstanceOf(ConflictError)
    })
  })

  describe('un-relating', () => {
    test('is a row carrying the words of the relation it takes off, never a delete', async () => {
      await relate({ how: 'supersedes' })
      const removed = await relate({ related: false, actor: 'human' })

      expect(removed.version).toBe(2)
      expect(removed.relations).toEqual([])

      const history = await harness.store.recordRelations.listForRecord(ids[0] ?? 0)
      expect(
        history.map((entry) => [entry.version, entry.applied, entry.how, entry.actor]),
      ).toEqual([
        [1, true, 'supersedes', 'ai'],
        [2, false, 'supersedes', 'human'],
      ])
    })

    test('drops the line from both records’ pages', async () => {
      await relate({ how: 'supersedes' })
      await relate({ related: false })

      expect(await readFrom(ids[0] ?? 0)).toEqual([])
      expect(await readFrom(ids[1] ?? 0)).toEqual([])
    })

    /** Relating a pair somebody took apart is version 3 and may use new words. */
    test('re-relating continues the pair’s sequence and may say something new', async () => {
      await relate({ how: 'supersedes' })
      await relate({ related: false })
      const again = await relate({ how: 'turned out to be the same bug' })

      expect(again.version).toBe(3)
      expect(again.relations[0]?.how).toBe('turned out to be the same bug')
    })
  })

  /**
   * The AI's read-back channel — #103's lesson one table over. A relation is
   * written through the CLI and checked by listing the records, so a listing
   * silent about relations reads exactly like a store that refused every write.
   */
  describe('the revision listing carries them', () => {
    test('with the far record’s address rather than its title', async () => {
      await relate({ fromId: ids[0], toId: pastId, how: 'the same lock again' })

      const { records } = await harness.app.records.list.execute({
        actor: 'ai',
        retro: { retroId },
      })

      expect(records[0]?.relations).toEqual([
        {
          globalId: pastId,
          // The pair every other read the AI makes is addressed by — this is
          // what "find past records" costs it.
          retroId: pastRetroId,
          rid: 'r-stale-lock',
          how: 'the same lock again',
          direction: 'outgoing',
          actor: 'ai',
          at: harness.clock.iso(),
        },
      ])
      expect(records[1]?.relations).toEqual([])
    })

    test('and drops them again when the relation is taken off', async () => {
      await relate({ how: 'supersedes' })
      await relate({ related: false })

      const { records } = await harness.app.records.list.execute({
        actor: 'ai',
        retro: { retroId },
      })

      expect(records.flatMap((record) => record.relations)).toEqual([])
    })
  })
})
