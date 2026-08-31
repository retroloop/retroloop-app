import { beforeEach, describe, expect, test } from 'bun:test'
import type { Store } from '#application/ports/store.port'
import type { NewHold } from '#domain/models/hold.model'
import { type StoreFactory, seedRetrospective, seedSession } from './store.contract'

export function describeHoldRepositoryContract(label: string, makeStore: StoreFactory): void {
  describe(`${label} · HoldRepository`, () => {
    let store: Store
    let retroId: number
    let otherRetroId: number

    const aNewHold = (overrides: Partial<NewHold> = {}): NewHold => ({
      retroId,
      rid: 'r-deploy-blocked',
      version: 1,
      held: true,
      note: undefined,
      at: '2026-08-25T10:00:00.000Z',
      ...overrides,
    })

    beforeEach(async () => {
      store = await makeStore()
      const sessionId = await seedSession(store)
      retroId = await seedRetrospective(store, sessionId)
      otherRetroId = await seedRetrospective(store, sessionId)
    })

    test('stores a hold and reads it back as the version in force', async () => {
      const hold = await store.holds.add(aNewHold({ note: 'Not until the release ships.' }))

      expect(await store.holds.findLatest(retroId, 'r-deploy-blocked')).toEqual(hold)
      expect(hold.held).toBe(true)
      expect(hold.note).toBe('Not until the release ships.')
    })

    /**
     * SQLite has no boolean, so `held` is a 0/1 column and both directions of
     * the conversion have to be proven — a `false` that came back as `0` would
     * be truthy everywhere above L1 and would silently park every record.
     */
    test('keeps `held` a boolean in both directions', async () => {
      await store.holds.add(aNewHold({ rid: 'r-parked', held: true }))
      await store.holds.add(aNewHold({ rid: 'r-released', held: false }))

      expect((await store.holds.findLatest(retroId, 'r-parked'))?.held).toBe(true)
      expect((await store.holds.findLatest(retroId, 'r-released'))?.held).toBe(false)
    })

    test('keeps a reason verbatim, and an absent one absent', async () => {
      await store.holds.add(aNewHold({ rid: 'r-noted', note: '  Not enough data yet.  ' }))

      expect((await store.holds.findLatest(retroId, 'r-noted'))?.note).toBe(
        '  Not enough data yet.  ',
      )
      expect((await store.holds.findLatest(retroId, 'r-deploy-blocked'))?.note).toBeUndefined()
    })

    test('returns undefined for a record that was never held', async () => {
      expect(await store.holds.findLatest(retroId, 'r-never-touched')).toBeUndefined()
    })

    /** A release is a row, so the reason it was parked stays readable forever (D4). */
    test('appends versions and keeps every one of them', async () => {
      const parked = await store.holds.add(aNewHold({ version: 1, note: 'The fix looks risky.' }))
      const released = await store.holds.add(aNewHold({ version: 2, held: false }))

      expect(await store.holds.listForRecord(retroId, 'r-deploy-blocked')).toEqual([
        parked,
        released,
      ])
      expect(await store.holds.findLatest(retroId, 'r-deploy-blocked')).toEqual(released)
    })

    test('returns the version in force for each record of a retrospective', async () => {
      await store.holds.add(aNewHold({ rid: 'r-one', version: 1 }))
      const latestOne = await store.holds.add(aNewHold({ rid: 'r-one', version: 2, held: false }))
      const two = await store.holds.add(aNewHold({ rid: 'r-two' }))
      await store.holds.add(aNewHold({ retroId: otherRetroId, rid: 'r-elsewhere' }))

      const latest = await store.holds.listLatestByRetro(retroId)
      expect(latest).toHaveLength(2)
      expect(latest).toEqual(expect.arrayContaining([latestOne, two]))
    })

    /**
     * Versions are numbered per record, so two retrospectives both holding an
     * `r-one` v1 and an `r-one` v2 must not shadow each other.
     */
    test('never lets one retrospective’s versions shadow another’s', async () => {
      await store.holds.add(aNewHold({ rid: 'r-one', version: 1 }))
      const here = await store.holds.add(aNewHold({ rid: 'r-one', version: 2, held: false }))
      const there = await store.holds.add(aNewHold({ retroId: otherRetroId, rid: 'r-one' }))

      expect(await store.holds.listLatestByRetro(retroId)).toEqual([here])
      expect(await store.holds.listLatestByRetro(otherRetroId)).toEqual([there])
    })

    test('lists nothing for a retrospective with no holds', async () => {
      expect(await store.holds.listLatestByRetro(404)).toEqual([])
      expect(await store.holds.listForRecord(404, 'r-nope')).toEqual([])
    })
  })
}
