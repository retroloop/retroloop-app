import { beforeEach, describe, expect, test } from 'bun:test'
import { EXPORT_FORMAT, type RetroExport } from '#application/views/export.view'
import { ConflictError } from '#domain/errors/conflict.error'
import { NotFoundError } from '#domain/errors/not-found.error'
import type { Session } from '#domain/models/session.model'
import { aRecordInput } from '../support/fixtures'
import { createHarness, type Harness } from '../support/harness'
import { loadExportSchema, validate } from '../support/json-schema'

const schema = loadExportSchema()

/** Every violation, so a failure names what is wrong rather than just failing. */
function conformanceProblems(document: RetroExport): string[] {
  // Round-trip through JSON first: the contract is a *file*, and `undefined`
  // members vanish on the way there. Validating the in-memory object would test
  // something the consumer never sees.
  return validate(JSON.parse(JSON.stringify(document)), schema, schema)
}

describe('export', () => {
  let harness: Harness
  let session: Session

  beforeEach(async () => {
    harness = createHarness()
    session = await harness.session('uuid-export')
  })

  /** A finished retrospective with two decided records, comments and a review thread. */
  async function aFinishedRetrospective(): Promise<number> {
    const { retroId } = await harness.revision(session.id, [
      { rid: 'r-stale-lock', num: 1 },
      { rid: 'r-slow-tests', num: 2 },
    ])
    await harness.app.threads.addComment.execute({
      actor: 'human',
      retro: { retroId },
      target: { kind: 'record', rid: 'r-stale-lock', section: 'problem' },
      text: 'The impact is understated.',
    })
    await harness.app.threads.addComment.execute({
      actor: 'ai',
      retro: { retroId },
      target: { kind: 'record', rid: 'r-stale-lock', section: 'problem' },
      text: 'Rewritten with the measured numbers.',
    })
    await harness.app.threads.addComment.execute({
      actor: 'human',
      retro: { retroId },
      target: { kind: 'review' },
      text: 'Good set overall.',
    })
    await harness.app.decisions.record.execute({
      actor: 'human',
      retro: { retroId },
      rid: 'r-stale-lock',
      decision: { state: 'approved', severity: 2, reviewerNote: 'Do this one first.' },
    })
    await harness.app.decisions.record.execute({
      actor: 'human',
      retro: { retroId },
      rid: 'r-slow-tests',
      decision: { state: 'declined' },
    })
    await harness.closeReview(retroId)
    return retroId
  }

  test('conforms to export.v1.schema.json', async () => {
    const retroId = await aFinishedRetrospective()

    const { export: document } = await harness.app.exports.retrospective.execute({
      actor: 'ai',
      retro: { retroId },
    })

    expect(conformanceProblems(document)).toEqual([])
  })

  test('carries the envelope, the session and the retrospective', async () => {
    const retroId = await aFinishedRetrospective()

    const { export: document } = await harness.app.exports.retrospective.execute({
      actor: 'ai',
      retro: { retroId },
    })

    expect(document.format).toBe(EXPORT_FORMAT)
    expect(document.generatedAt).toBe(harness.clock.iso())
    expect(document.project).toBe('retro')
    expect(document.session).toEqual({
      id: session.id,
      claudeSession: 'uuid-export',
      project: 'retro',
      cwd: '/Users/sample/Developer/retro',
      branch: 'main',
      supervised: true,
      startedAt: harness.clock.iso(),
    })
    expect(document.retrospective).toEqual({
      id: retroId,
      title: null,
      state: 'finished',
      finishedAt: harness.clock.iso(),
      revisions: 1,
      // He finished the round without writing one; the key is still there,
      // because a key that comes and goes is a shape a script has to guess at.
      finishMessages: [],
      reviewed: 'human',
    })
  })

  /**
   * `r-finish-confirm-message`, the half of it the document carries: the
   * finish message is delivered separately from the comments, and per
   * revision round — so it is its own array on the retrospective, keyed by the
   * revision whose round it closes, and no thread is involved.
   */
  describe('the final message on each round', () => {
    test('carries the word he left, with the round it closes', async () => {
      const { retroId } = await harness.revision(session.id, [{ rid: 'r-stale-lock', num: 1 }])
      await harness.app.decisions.record.execute({
        actor: 'human',
        retro: { retroId },
        rid: 'r-stale-lock',
        decision: { state: 'approved' },
      })
      await harness.app.review.finish.execute({
        actor: 'human',
        retro: { retroId },
        finishMessage: 'Ship this one; open a follow-up for the lock file.',
      })
      await harness.app.review.close.execute({ actor: 'ai', retro: { retroId } })

      const { export: document } = await harness.app.exports.retrospective.execute({
        actor: 'ai',
        retro: { retroId },
      })

      expect(document.retrospective.finishMessages).toEqual([
        {
          revision: 1,
          message: 'Ship this one; open a follow-up for the lock file.',
          at: harness.clock.iso(),
        },
      ])
      expect(conformanceProblems(document)).toEqual([])
      // Separately from the comments, as he asked: nothing about it is a thread.
      expect(document.reviewThreads).toEqual([])
    })

    /** Per revision round, so a retrospective that went twice carries both. */
    test('carries one entry per round, in revision order', async () => {
      const { retroId } = await harness.revision(session.id, [{ rid: 'r-stale-lock', num: 1 }])
      await harness.app.decisions.record.execute({
        actor: 'human',
        retro: { retroId },
        rid: 'r-stale-lock',
        decision: { state: 'approved' },
      })
      await harness.app.review.finish.execute({
        actor: 'human',
        retro: { retroId },
        finishMessage: 'Close, but the problem statement understates it.',
      })

      await harness.revision(session.id, [
        { rid: 'r-stale-lock', num: 1, problem: 'A rewritten problem statement.' },
      ])
      await harness.app.decisions.record.execute({
        actor: 'human',
        retro: { retroId },
        rid: 'r-stale-lock',
        decision: { state: 'approved' },
      })
      await harness.app.review.finish.execute({
        actor: 'human',
        retro: { retroId },
        finishMessage: 'Good. Ship it.',
      })
      await harness.app.review.close.execute({ actor: 'ai', retro: { retroId } })

      const { export: document } = await harness.app.exports.retrospective.execute({
        actor: 'ai',
        retro: { retroId },
      })

      expect(
        document.retrospective.finishMessages.map((one) => [one.revision, one.message]),
      ).toEqual([
        [1, 'Close, but the problem statement understates it.'],
        [2, 'Good. Ship it.'],
      ])
      expect(conformanceProblems(document)).toEqual([])
    })

    /** A round he left no word on has no entry — nothing is invented for it. */
    test('skips a round he left no word on', async () => {
      const { retroId } = await harness.revision(session.id, [{ rid: 'r-stale-lock', num: 1 }])
      await harness.app.decisions.record.execute({
        actor: 'human',
        retro: { retroId },
        rid: 'r-stale-lock',
        decision: { state: 'approved' },
      })
      await harness.app.review.finish.execute({ actor: 'human', retro: { retroId } })

      await harness.revision(session.id, [
        { rid: 'r-stale-lock', num: 1, problem: 'A rewritten problem statement.' },
      ])
      await harness.app.decisions.record.execute({
        actor: 'human',
        retro: { retroId },
        rid: 'r-stale-lock',
        decision: { state: 'approved' },
      })
      await harness.app.review.finish.execute({
        actor: 'human',
        retro: { retroId },
        finishMessage: 'Now it says what happened.',
      })
      await harness.app.review.close.execute({ actor: 'ai', retro: { retroId } })

      const { export: document } = await harness.app.exports.retrospective.execute({
        actor: 'ai',
        retro: { retroId },
      })

      expect(document.retrospective.finishMessages).toEqual([
        { revision: 2, message: 'Now it says what happened.', at: harness.clock.iso() },
      ])
    })
  })

  test('carries the final narrative and the human’s decision fields', async () => {
    const retroId = await aFinishedRetrospective()

    const { export: document } = await harness.app.exports.retrospective.execute({
      actor: 'ai',
      retro: { retroId },
    })
    const approved = document.records[0]

    expect(approved?.rid).toBe('r-stale-lock')
    expect(approved?.state).toBe('approved')
    // The human's severity, not the AI's proposal of 3.
    expect(approved?.severity).toBe(2)
    expect(approved?.reviewerNote).toBe('Do this one first.')
    expect(approved?.rootCause.whys.length).toBeGreaterThan(0)
    expect(approved?.workaround).toBe('Delete the lock file by hand.')
  })

  /**
   * The document carries all three of a record's names now: the rid, its
   * position within its retrospective, and the number the product shows.
   *
   * The pairing is what makes this falsifiable — a second retrospective's
   * records are `num` 1 and 2 again and `globalId` 3 and 4, so a builder that
   * emitted `num` under the new key produces two documents that disagree with
   * each other rather than one that looks plausible.
   */
  test('carries each record’s global number beside its per-retro one', async () => {
    const first = await aFinishedRetrospective()
    const second = await aFinishedRetrospective()

    const documentFor = async (retroId: number) =>
      (await harness.app.exports.retrospective.execute({ actor: 'ai', retro: { retroId } })).export

    expect(
      (await documentFor(first)).records.map((record) => [record.globalId, record.num]),
    ).toEqual([
      [1, 1],
      [2, 2],
    ])
    expect(
      (await documentFor(second)).records.map((record) => [record.globalId, record.num]),
    ).toEqual([
      [3, 1],
      [4, 2],
    ])
  })

  test('exports declined records too — an export is the whole outcome (D6)', async () => {
    const retroId = await aFinishedRetrospective()

    const { export: document } = await harness.app.exports.retrospective.execute({
      actor: 'ai',
      retro: { retroId },
    })

    expect(document.records.map((record) => [record.rid, record.state])).toEqual([
      ['r-stale-lock', 'approved'],
      ['r-slow-tests', 'declined'],
    ])
  })

  test('emits null, not an absent key, where the schema requires a nullable field', async () => {
    const retroId = await aFinishedRetrospective()

    const { export: document } = await harness.app.exports.retrospective.execute({
      actor: 'ai',
      retro: { retroId },
    })
    const written = JSON.parse(JSON.stringify(document)) as RetroExport

    // `reviewerNote` is required and nullable; the declined record has none.
    expect(written.records[1]?.reviewerNote).toBeNull()
    expect(Object.keys(written.records[1] ?? {})).toContain('reviewerNote')
  })

  /**
   * `session create --project` is optional. The export is the one
   * public contract, so the absence has to arrive as `null` in both
   * places the document names a project — an import script reading a key that
   * comes and goes has to guess which of the two happened.
   */
  test('exports a session that never named a project, as null and not as an absent key', async () => {
    const { session: unnamed } = await harness.app.sessions.create.execute({
      actor: 'ai',
      claudeSession: 'uuid-no-project',
      cwd: '/Users/sample/Developer/retro',
    })
    const { retroId } = await harness.revision(unnamed.id, [{ rid: 'r-one', num: 1 }])
    await harness.decide(retroId, 'r-one', 'approved')
    await harness.closeReview(retroId)

    const { export: document } = await harness.app.exports.retrospective.execute({
      actor: 'ai',
      retro: { retroId },
    })
    const written = JSON.parse(JSON.stringify(document)) as RetroExport

    expect(conformanceProblems(document)).toEqual([])
    expect(written.project).toBeNull()
    expect(written.session.project).toBeNull()
    expect(Object.keys(written.session)).toContain('project')
  })

  test('nests a record’s threads under it and keeps review threads separate', async () => {
    const retroId = await aFinishedRetrospective()

    const { export: document } = await harness.app.exports.retrospective.execute({
      actor: 'ai',
      retro: { retroId },
    })

    expect(document.records[0]?.threads).toEqual([
      {
        component: 'problem',
        resolved: false,
        messages: [
          {
            actor: 'human',
            at: harness.clock.iso(),
            text: 'The impact is understated.',
            revision: 1,
          },
          {
            actor: 'ai',
            at: harness.clock.iso(),
            text: 'Rewritten with the measured numbers.',
            revision: 1,
          },
        ],
      },
    ])
    expect(document.records[1]?.threads).toEqual([])
    expect(document.reviewThreads).toEqual([
      {
        component: 'review',
        resolved: false,
        messages: [
          { actor: 'human', at: harness.clock.iso(), text: 'Good set overall.', revision: 1 },
        ],
      },
    ])
  })

  /**
   * The two keys `r-resolvable-comments` and the revision label added to the
   * contract, proved on a document where neither could be right by accident: the
   * conversation crosses two revisions, so a message stamped 1 and a message
   * stamped 2 sit in the same thread, and one thread is resolved while the other
   * is not.
   */
  test('carries each message’s revision and whether the human settled the thread', async () => {
    const { retroId } = await harness.revision(session.id, [{ rid: 'r-stale-lock', num: 1 }])
    const { thread } = await harness.app.threads.addComment.execute({
      actor: 'human',
      retro: { retroId },
      target: { kind: 'record', rid: 'r-stale-lock', section: 'problem' },
      text: 'Written while revision 1 was the only one.',
    })
    const { thread: review } = await harness.app.threads.addComment.execute({
      actor: 'human',
      retro: { retroId },
      target: { kind: 'review' },
      text: 'Left open on purpose.',
    })

    await harness.finishRound(retroId)
    await harness.revision(session.id, [{ rid: 'r-stale-lock', num: 1 }])
    await harness.app.threads.addComment.execute({
      actor: 'ai',
      target: { kind: 'thread', threadId: thread.id },
      text: 'Answered once revision 2 was filed.',
    })
    await harness.app.threads.resolve.execute({
      actor: 'human',
      threadId: thread.id,
      resolved: true,
    })

    await harness.decide(retroId, 'r-stale-lock', 'approved')
    await harness.closeReview(retroId)

    const { export: document } = await harness.app.exports.retrospective.execute({
      actor: 'ai',
      retro: { retroId },
    })

    expect(document.records[0]?.threads[0]?.resolved).toBe(true)
    expect(document.records[0]?.threads[0]?.messages.map((message) => message.revision)).toEqual([
      1, 2,
    ])
    expect(document.reviewThreads[0]?.resolved).toBe(false)
    expect(review.resolved).toBe(false)
    expect(conformanceProblems(document)).toEqual([])
  })

  test('filters to one state when asked', async () => {
    const retroId = await aFinishedRetrospective()

    const { export: document } = await harness.app.exports.retrospective.execute({
      actor: 'ai',
      retro: { retroId },
      state: 'approved',
    })

    expect(document.records.map((record) => record.rid)).toEqual(['r-stale-lock'])
    expect(conformanceProblems(document)).toEqual([])
  })

  /**
   * The retro's name travels with the outcome. It is the **final**
   * revision's title for the same reason the narrative is that revision's: the
   * export is what the review settled on, not what it started from.
   */
  test('carries the final revision’s title, and null when that revision had none', async () => {
    const { retroId } = await harness.app.revisions.create.execute({
      actor: 'ai',
      session: session.id,
      revision: { title: 'The first name it went by', records: [aRecordInput({ rid: 'r-one' })] },
    })
    await harness.finishRound(retroId)
    await harness.app.revisions.create.execute({
      actor: 'ai',
      session: session.id,
      revision: {
        title: 'The lock that outlived its process',
        records: [aRecordInput({ rid: 'r-one' })],
      },
    })
    await harness.decide(retroId, 'r-one', 'approved')
    await harness.closeReview(retroId)

    const { export: document } = await harness.app.exports.retrospective.execute({
      actor: 'ai',
      retro: { retroId },
    })

    expect(document.retrospective.title).toBe('The lock that outlived its process')
    expect(conformanceProblems(document)).toEqual([])
  })

  test('exports the final revision’s narrative, not the first', async () => {
    const { retroId } = await harness.revision(session.id, [{ rid: 'r-one', num: 1 }])
    await harness.finishRound(retroId)
    await harness.revision(session.id, [
      { rid: 'r-one', num: 1, title: 'The title as it finally stood' },
    ])
    await harness.decide(retroId, 'r-one', 'approved')
    await harness.closeReview(retroId)

    const { export: document } = await harness.app.exports.retrospective.execute({
      actor: 'ai',
      retro: { retroId },
    })

    expect(document.records[0]?.title).toBe('The title as it finally stood')
    expect(document.retrospective.revisions).toBe(2)
  })

  /**
   * **Dropping a record from a later draft drops it from the outcome**, verdict
   * and all. The export renders the final revision, and both gates read the same
   * set — so a record approved in revision 1 and left out of revision 2 is not
   * pending, does not block the close, and is simply not in the file.
   *
   * A cold agent has no way to guess that from anywhere else, and the mistake is
   * silent and unrecoverable-looking: SKILL.md now says it in the identity
   * section, which is why it is pinned here.
   */
  test('a record dropped from the final revision leaves the export with it', async () => {
    const { retroId } = await harness.revision(session.id, [
      { rid: 'r-one', num: 1 },
      { rid: 'r-two', num: 2 },
    ])
    await harness.decide(retroId, 'r-one', 'approved')
    await harness.decide(retroId, 'r-two', 'approved')
    await harness.finishRound(retroId)
    await harness.revision(session.id, [{ rid: 'r-one', num: 1 }])

    // The gate does not ask about it either — the close goes through untouched.
    await harness.closeReview(retroId)
    const { export: document } = await harness.app.exports.retrospective.execute({
      actor: 'ai',
      retro: { retroId },
    })

    expect(document.records.map((record) => record.rid)).toEqual(['r-one'])
  })

  test('refuses to export a review that is still open', async () => {
    const { retroId } = await harness.revision(session.id)

    await expect(
      harness.app.exports.retrospective.execute({ actor: 'ai', retro: { retroId } }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  test('is a NotFound for a retrospective that does not exist', async () => {
    await expect(
      harness.app.exports.retrospective.execute({ actor: 'ai', retro: { retroId: 404 } }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  test('resolves a session reference to its finished retrospective', async () => {
    const retroId = await aFinishedRetrospective()

    const { export: document } = await harness.app.exports.retrospective.execute({
      actor: 'ai',
      retro: { session: session.id },
    })

    expect(document.retrospective.id).toBe(retroId)
  })

  /**
   * The evidence leaves the product with the outcome.
   *
   * It is **optional in the contract and emitted whenever the record has any**,
   * which is the `globalId` rule rather than the `reviewerNote` one: a document
   * written before the field existed is a valid `retro.export.v1` and must stay
   * one, so the key is absent on a legacy record instead of being converted to
   * `null`. A consumer therefore reads "this record has no diagnostic data" from
   * the key not being there, exactly as it reads a record's shape from which of
   * `solutions` and `agreedDirection` it finds.
   */
  describe('the diagnostic data', () => {
    test('carries the evidence of a record filed with it', async () => {
      const { retroId } = await harness.revision(session.id, [{ rid: 'r-stale-lock', num: 1 }])
      await harness.decide(retroId, 'r-stale-lock', 'approved')
      await harness.closeReview(retroId)

      const { export: document } = await harness.app.exports.retrospective.execute({
        actor: 'ai',
        retro: { retroId },
      })
      const written = JSON.parse(JSON.stringify(document)) as RetroExport

      expect(conformanceProblems(document)).toEqual([])
      expect(written.records[0]?.diagnosticData).toBe(aRecordInput().diagnosticData)
    })

    test('leaves the key off a record filed before the field existed, and still conforms', async () => {
      const legacy = await harness.legacyRevision(session.id, {})
      await harness.decide(legacy.retroId, legacy.record.rid, 'approved')
      await harness.closeReview(legacy.retroId)

      const { export: document } = await harness.app.exports.retrospective.execute({
        actor: 'ai',
        retro: { retroId: legacy.retroId },
      })
      const written = JSON.parse(JSON.stringify(document)) as RetroExport

      expect(conformanceProblems(document)).toEqual([])
      expect(Object.keys(written.records[0] ?? {})).not.toContain('diagnosticData')
    })
  })

  /**
   * A document carries the shape its record was filed in — the two legacy keys,
   * or `solutions` plus the human's pick — and never both, never neither. The
   * contract admits all four keys forever (`export.v1.schema.json`), which is
   * what keeps existing exports valid; the builder is what
   * narrows.
   */
  describe('the shape of a record’s proposals', () => {
    test('a record with solutions carries them, and the selection the human made', async () => {
      const { retroId } = await harness.revision(session.id, [{ rid: 'r-stale-lock', num: 1 }])
      await harness.app.decisions.record.execute({
        actor: 'human',
        retro: { retroId },
        rid: 'r-stale-lock',
        decision: { state: 'approved', selectedSolution: 1 },
      })
      await harness.closeReview(retroId)

      const { export: document } = await harness.app.exports.retrospective.execute({
        actor: 'ai',
        retro: { retroId },
      })
      const written = JSON.parse(JSON.stringify(document)) as RetroExport
      const record = written.records[0]

      expect(conformanceProblems(document)).toEqual([])
      expect(record?.solutions).toEqual(aRecordInput().solutions)
      expect(record?.selectedSolution).toBe(1)
      // The level is the selected solution's, so a consumer that only reads
      // `solutionLevel` still gets the answer it always got.
      expect(record?.solutionLevel).toBe(1)
      expect(Object.keys(record ?? {})).not.toContain('agreedDirection')
      expect(Object.keys(record ?? {})).not.toContain('footprint')
    })

    test('a record filed before solutions existed carries its direction and footprint', async () => {
      const legacy = await harness.legacyRevision(session.id, {})
      await harness.decide(legacy.retroId, legacy.record.rid, 'approved')
      await harness.closeReview(legacy.retroId)

      const { export: document } = await harness.app.exports.retrospective.execute({
        actor: 'ai',
        retro: { retroId: legacy.retroId },
      })
      const written = JSON.parse(JSON.stringify(document)) as RetroExport
      const record = written.records[0]

      expect(conformanceProblems(document)).toEqual([])
      expect(record?.agreedDirection).toBe(legacy.record.agreedDirection)
      expect(record?.footprint).toBe(legacy.record.footprint)
      expect(Object.keys(record ?? {})).not.toContain('solutions')
      expect(Object.keys(record ?? {})).not.toContain('selectedSolution')
    })
  })
})
