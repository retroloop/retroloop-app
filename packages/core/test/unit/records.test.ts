import { beforeEach, describe, expect, test } from 'bun:test'
import { NotFoundError } from '#domain/errors/not-found.error'
import type { Session } from '#domain/models/session.model'
import { someSolutions } from '../support/fixtures'
import { createHarness, type Harness } from '../support/harness'

describe('records', () => {
  let harness: Harness
  let session: Session

  beforeEach(async () => {
    harness = createHarness()
    session = await harness.session()
  })

  describe('list', () => {
    test('returns the revision’s records with the state each one is in', async () => {
      const { retroId, revision } = await harness.revision(session.id, [{}, {}])
      await harness.decide(retroId, revision.records[0]?.rid ?? '', 'declined')

      const { records, revisionN } = await harness.app.records.list.execute({
        actor: 'ai',
        retro: { retroId },
      })

      expect(revisionN).toBe(1)
      expect(records.map((view) => view.decision.state)).toEqual(['declined', 'pending'])
      // A decline keeps the record — it is a state, not a deletion.
      expect(records).toHaveLength(2)
    })

    test('filters on the effective state', async () => {
      const { retroId, revision } = await harness.revision(session.id, [{}, {}])
      await harness.decide(retroId, revision.records[0]?.rid ?? '', 'approved')

      expect(
        (
          await harness.app.records.list.execute({
            actor: 'ai',
            retro: { retroId },
            state: 'pending',
          })
        ).records.map((view) => view.record.rid),
      ).toEqual([revision.records[1]?.rid ?? ''])
      // `hold` is still a state the filter admits — a decision made before
      // `r-hold-semantics` can carry it — and no store written since has one.
      expect(
        (await harness.app.records.list.execute({ actor: 'ai', retro: { retroId }, state: 'hold' }))
          .records,
      ).toEqual([])
    })

    test('carries an unchanged record’s decision into the next revision', async () => {
      const { retroId } = await harness.revision(session.id, [
        { rid: 'r-one', num: 1 },
        { rid: 'r-two', num: 2 },
      ])
      await harness.decide(retroId, 'r-one', 'approved')
      await harness.decide(retroId, 'r-two', 'approved')
      // The round has to be put down before the next one may answer it.
      await harness.finishRound(retroId)

      await harness.revision(session.id, [
        { rid: 'r-one', num: 1 },
        { rid: 'r-two', num: 2, problem: 'A rewritten problem statement.' },
      ])

      const { records } = await harness.app.records.list.execute({
        actor: 'ai',
        retro: { retroId },
      })

      expect(records[0]?.decision.state).toBe('approved')
      expect(records[0]?.decision.carriedOver).toBe(true)
      expect(records[0]?.decision.decidedOnRevision).toBe(1)
      // The rewritten record is pending again, and says which revision it was decided on.
      expect(records[1]?.decision.state).toBe('pending')
      expect(records[1]?.decision.contentChangedSince).toBe(1)
    })

    test('reads an earlier revision when asked', async () => {
      const { retroId } = await harness.revision(session.id, [{ rid: 'r-one', num: 1 }])
      await harness.finishRound(retroId)
      await harness.revision(session.id, [
        { rid: 'r-one', num: 1 },
        { rid: 'r-two', num: 2 },
      ])

      expect(
        (await harness.app.records.list.execute({ actor: 'ai', retro: { retroId }, revision: 1 }))
          .records,
      ).toHaveLength(1)
    })

    test('is a NotFound for an unknown retrospective or revision', async () => {
      const { retroId } = await harness.revision(session.id)

      await expect(
        harness.app.records.list.execute({ actor: 'ai', retro: { retroId: 404 } }),
      ).rejects.toBeInstanceOf(NotFoundError)
      await expect(
        harness.app.records.list.execute({ actor: 'ai', retro: { retroId }, revision: 7 }),
      ).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  describe('get', () => {
    test('returns one record with its decision history and its threads', async () => {
      const { retroId, revision } = await harness.revision(session.id)
      const rid = revision.records[0]?.rid ?? ''
      await harness.decide(retroId, rid, 'declined')
      await harness.decide(retroId, rid, 'approved')
      await harness.app.threads.addComment.execute({
        actor: 'human',
        retro: { retroId },
        target: { kind: 'record', rid, section: 'direction' },
        text: 'Let us do the smaller version first.',
      })

      const view = await harness.app.records.get.execute({ actor: 'ai', retro: { retroId }, rid })

      expect(view.record.record.rid).toBe(rid)
      expect(view.record.decision.state).toBe('approved')
      expect(view.decisions.map((decision) => [decision.version, decision.state])).toEqual([
        [1, 'declined'],
        [2, 'approved'],
      ])
      expect(view.threads).toHaveLength(1)
    })

    test('is a NotFound for a record that is not in that revision', async () => {
      const { retroId } = await harness.revision(session.id)

      await expect(
        harness.app.records.get.execute({ actor: 'ai', retro: { retroId }, rid: 'r-nope' }),
      ).rejects.toBeInstanceOf(NotFoundError)
      await expect(
        harness.app.records.get.execute({ actor: 'ai', retro: { retroId: 404 }, rid: 'r-one' }),
      ).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  describe('history', () => {
    test('shows one record across revisions, with what changed and what was decided', async () => {
      const { retroId } = await harness.revision(session.id, [{ rid: 'r-one', num: 1 }])
      await harness.decide(retroId, 'r-one', 'approved')
      await harness.finishRound(retroId)
      await harness.revision(session.id, [
        {
          rid: 'r-one',
          num: 1,
          solutions: someSolutions([{ bullets: '- **A different plan.** Do it another way.' }]),
        },
      ])
      await harness.decide(retroId, 'r-one', 'declined')

      const history = await harness.app.records.history.execute({
        actor: 'ai',
        retro: { retroId },
        rid: 'r-one',
      })

      expect(history.appearances).toHaveLength(2)
      expect(history.appearances[0]?.changedSections).toEqual([])
      expect(history.appearances[0]?.decision?.state).toBe('approved')
      expect(history.appearances[1]?.changedSections).toEqual(['solutions'])
      expect(history.appearances[1]?.decision?.state).toBe('declined')
    })

    test('skips the revisions a record was absent from', async () => {
      const { retroId } = await harness.revision(session.id, [
        { rid: 'r-one', num: 1 },
        { rid: 'r-two', num: 2 },
      ])
      await harness.finishRound(retroId)
      await harness.revision(session.id, [{ rid: 'r-one', num: 1 }])
      await harness.finishRound(retroId)
      await harness.revision(session.id, [
        { rid: 'r-one', num: 1 },
        { rid: 'r-two', num: 2 },
      ])

      const history = await harness.app.records.history.execute({
        actor: 'ai',
        retro: { retroId },
        rid: 'r-two',
      })

      expect(history.appearances.map((appearance) => appearance.revisionN)).toEqual([1, 3])
    })

    test('is a NotFound for a record that never appeared', async () => {
      const { retroId } = await harness.revision(session.id)

      await expect(
        harness.app.records.history.execute({ actor: 'ai', retro: { retroId }, rid: 'r-ghost' }),
      ).rejects.toBeInstanceOf(NotFoundError)
    })
  })
})
