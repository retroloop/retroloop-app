import { beforeEach, describe, expect, test } from 'bun:test'
import { ConflictError } from '#domain/errors/conflict.error'
import { NotFoundError } from '#domain/errors/not-found.error'
import type { Actor } from '#domain/models/actor.model'
import { createHarness, type Harness } from '../support/harness'

/**
 * `ClaimRecordUseCase` — the in-progress marker the solving lane picks work up
 * with (`record-claim.model.ts`).
 *
 * Three claims run through the whole file, and each has a test that fails
 * without it: a claim is **exclusive** (a second one is refused rather than
 * absorbed), it is **append-only** (releasing is a row, so re-claiming is
 * version 3), and it is **cleared by the resolve** rather than left standing
 * over finished work.
 */
describe('record claims', () => {
  let harness: Harness
  let retroId: number
  let rids: readonly string[]
  /** The global ids of this retrospective's two records — what a claim is addressed by. */
  let ids: readonly number[]

  beforeEach(async () => {
    harness = createHarness()
    const session = await harness.session()
    const created = await harness.revision(session.id, [
      { rid: 'r-stale-lock' },
      { rid: 'r-silent-tailer' },
    ])
    retroId = created.retroId
    rids = created.revision.records.map((record) => record.rid)
    ids = await Promise.all(
      rids.map(async (rid) => (await harness.store.recordIds.findByRecord(retroId, rid))?.id ?? 0),
    )
  })

  const claim = (
    input: { readonly actor?: Actor; readonly id?: number; readonly claimed?: boolean } = {},
  ) =>
    harness.app.records.claim.execute({
      actor: input.actor ?? 'ai',
      id: input.id ?? ids[0] ?? 0,
      claimed: input.claimed ?? true,
    })

  const resolve = (rid: string, actor: Actor = 'ai') =>
    harness.app.records.setLifecycle.execute({
      actor,
      retro: { retroId },
      rid,
      status: 'resolved',
      refs: ['a1b2c3d'],
    })

  const rows = async () => harness.store.recordClaims.listLatestForEachRecord()

  describe('taking a record', () => {
    test('writes the first version, with its author and the moment it was taken', async () => {
      const result = await claim()

      expect(result).toEqual({
        recordId: ids[0] ?? 0,
        retroId,
        rid: rids[0] ?? '',
        version: 1,
        claim: { claimedAt: harness.clock.iso(), actor: 'ai' },
      })
    })

    /**
     * **Either actor may hold a record**, which this table shares with the
     * lifecycle and the relations and with nothing else. The CLI writes `ai`;
     * the column is what makes a human's claim representable.
     */
    test('records which actor took it', async () => {
      const result = await claim({ actor: 'human' })

      expect(result.claim?.actor).toBe('human')
      expect((await rows())[0]?.actor).toBe('human')
    })

    /**
     * The whole point of the marker: a second agent reading the same queue must
     * be refused rather than told "done" — that is the quiet inference this
     * product refuses everywhere (`LIFECYCLE_ACT_FROM`'s standing).
     */
    test('refuses a second claim, and says since when', async () => {
      await claim()

      const failure = claim()
      await expect(failure).rejects.toBeInstanceOf(ConflictError)
      await expect(failure).rejects.toThrow(/already claimed/)
      expect(await rows()).toHaveLength(1)
    })

    test('is refused on a resolved record — there is nothing left to work on', async () => {
      await resolve(rids[0] ?? '')

      await expect(claim()).rejects.toBeInstanceOf(ConflictError)
      expect(await rows()).toEqual([])
    })

    /**
     * A declined record is `archived` from birth with no row saying so
     * (`lifecycle.md`), so this is the derivation rather than a table read — the
     * half a join-and-stop guard would get wrong.
     */
    test('is refused on a record the review declined, with no archive row behind it', async () => {
      await harness.decide(retroId, rids[0] ?? '', 'declined')

      await expect(claim()).rejects.toBeInstanceOf(ConflictError)
      expect(await rows()).toEqual([])
    })

    test('is a NotFound for a number nothing was minted for', async () => {
      await expect(claim({ id: 404 })).rejects.toBeInstanceOf(NotFoundError)
    })

    /**
     * Everything listable is claimable and everything claimable is listable —
     * the rule `ApplyLabelUseCase` and `SetRecordLifecycleUseCase` both apply to
     * the one record they touch.
     */
    test('is a NotFound for a record a later draft withdrew', async () => {
      const sessionId = (await harness.store.retrospectives.findById(retroId))?.sessionId ?? 0
      await harness.finishRound(retroId)
      await harness.revision(sessionId, [{ rid: rids[0] ?? '' }])

      await expect(claim({ id: ids[1] })).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  describe('giving it back', () => {
    test('clears the claim and keeps the row that took it', async () => {
      await claim()

      const released = await claim({ claimed: false })

      expect(released).toEqual({
        recordId: ids[0] ?? 0,
        retroId,
        rid: rids[0] ?? '',
        version: 2,
        claim: undefined,
      })
      expect((await rows())[0]).toMatchObject({ version: 2, claimed: false })
    })

    test('refuses to release a record nobody is holding', async () => {
      const failure = claim({ claimed: false })

      await expect(failure).rejects.toBeInstanceOf(ConflictError)
      await expect(failure).rejects.toThrow(/is not claimed/)
      expect(await rows()).toEqual([])
    })

    test('refuses a second release', async () => {
      await claim()
      await claim({ claimed: false })

      await expect(claim({ claimed: false })).rejects.toBeInstanceOf(ConflictError)
    })

    /**
     * **Releasing is a row, not a delete**, so picking the record up again is
     * version 3 — and "held on Monday, given back, held again on Wednesday"
     * stays readable.
     */
    test('lets the record be taken again, as a third version', async () => {
      await claim()
      await claim({ claimed: false })

      expect((await claim({ actor: 'human' })).version).toBe(3)
      expect((await rows())[0]).toMatchObject({ version: 3, claimed: true, actor: 'human' })
    })
  })

  describe('the outbox', () => {
    test('names each act, scoped to the record it was taken on', async () => {
      await claim()
      await claim({ claimed: false })

      const { events } = await harness.app.events.list.execute({ actor: 'ai', retro: { retroId } })
      expect(
        events
          .filter((event) => event.name === 'RecordClaimed' || event.name === 'RecordUnclaimed')
          .map((event) => [event.name, event.retroId, event.rid, event.revisionN, event.data]),
      ).toEqual([
        ['RecordClaimed', retroId, rids[0] ?? '', undefined, { version: 1, actor: 'ai' }],
        ['RecordUnclaimed', retroId, rids[0] ?? '', undefined, { version: 2, actor: 'ai' }],
      ])
    })
  })

  /**
   * **The one place anything but a claim act writes this table.** The work the
   * claim was about has finished, so a marker left standing would make every
   * resolved record read as still being worked on — and that is not an inference
   * from silence: it is the same actor, in the same unit of work, saying so.
   */
  describe('resolving a record', () => {
    test('clears the claim, as a row by whoever resolved it', async () => {
      await claim()

      await resolve(rids[0] ?? '', 'human')

      expect((await rows())[0]).toMatchObject({
        version: 2,
        claimed: false,
        actor: 'human',
        at: harness.clock.iso(),
      })
      expect((await harness.eventNames()).slice(-2)).toEqual(['RecordResolved', 'RecordUnclaimed'])
    })

    test('writes no claim row when nobody was holding the record', async () => {
      await resolve(rids[0] ?? '')

      expect(await rows()).toEqual([])
      expect((await harness.eventNames()).at(-1)).toBe('RecordResolved')
    })

    /** Reopening does not hand the record back to whoever had it — that is a claim. */
    test('does not re-claim it on a reopen', async () => {
      await claim()
      await resolve(rids[0] ?? '')
      await harness.app.records.setLifecycle.execute({
        actor: 'ai',
        retro: { retroId },
        rid: rids[0] ?? '',
        status: 'reopened',
      })

      expect((await rows())[0]).toMatchObject({ version: 2, claimed: false })
    })
  })

  /**
   * One claim, three read models. They are built differently on purpose — one
   * folds a revision, one folds the whole store, one reads a single record — so
   * the assertion that matters is that all three say the same thing (#103
   * `r-lifecycle-projection-gap`, one table over).
   */
  describe('what the read models say', () => {
    test('every projection shows the same claim, and nothing while there is none', async () => {
      const claimed = async () => {
        const { records } = await harness.app.records.list.execute({
          actor: 'ai',
          retro: { retroId },
        })
        const all = await harness.app.records.listAll.execute({ actor: 'ai' })
        const one = await harness.app.records.byId.execute({ actor: 'ai', id: ids[0] ?? 0 })
        return [
          records.find((view) => view.record.rid === rids[0])?.claim,
          all.records.find((row) => row.rid === rids[0])?.claim,
          one.claim,
        ]
      }

      expect(await claimed()).toEqual([undefined, undefined, undefined])

      await claim()
      const held = { claimedAt: harness.clock.iso(), actor: 'ai' as const }
      expect(await claimed()).toEqual([held, held, held])

      await claim({ claimed: false })
      expect(await claimed()).toEqual([undefined, undefined, undefined])
    })

    test('does not show one record’s claim on another’s row', async () => {
      await claim()

      const { records } = await harness.app.records.list.execute({
        actor: 'ai',
        retro: { retroId },
      })
      expect(records.find((view) => view.record.rid === rids[1])?.claim).toBeUndefined()
    })
  })
})
