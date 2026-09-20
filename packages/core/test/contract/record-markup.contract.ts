import { beforeEach, describe, expect, test } from 'bun:test'
import type { Store } from '#application/ports/store.port'
import { type StoreFactory, seedRetrospective, seedSession } from './store.contract'

/**
 * What a record wears and what it carries, against every adapter (testing.md
 * suite 1) — `record_labels` and `record_attribute_values`.
 *
 * Both are append-only, both are keyed on `(retroId, rid, definitionId)`, and
 * both number their versions **per definition** rather than per record. That
 * last property is the one worth a contract suite: a record wearing three labels
 * holds three independent `version: 1` rows, so an adapter that grouped by
 * `(retroId, rid)` alone would read one label's history as another's and would
 * still pass every type check in the system.
 */
export function describeRecordMarkupRepositoryContract(
  label: string,
  makeStore: StoreFactory,
): void {
  describe(`${label} · RecordLabelRepository`, () => {
    let store: Store
    let retroId: number
    let elsewhere: number
    let migrated: number
    let triage: number

    beforeEach(async () => {
      store = await makeStore()
      const sessionId = await seedSession(store)
      retroId = await seedRetrospective(store, sessionId)
      elsewhere = await seedRetrospective(store, sessionId)

      const define = async (name: string) =>
        (
          await store.labelDefinitions.add({
            name,
            retiredAt: undefined,
            createdAt: '2026-09-01T09:00:00.000Z',
          })
        ).id
      migrated = await define('migrated')
      triage = await define('needs-triage')
    })

    const apply = (
      overrides: Partial<Parameters<Store['recordLabels']['add']>[0]> = {},
    ): Promise<Awaited<ReturnType<Store['recordLabels']['add']>>> =>
      store.recordLabels.add({
        retroId,
        rid: 'r-stale-lock',
        labelId: migrated,
        version: 1,
        applied: true,
        at: '2026-09-01T10:00:00.000Z',
        ...overrides,
      })

    test('stores an entry and reads it back on the record', async () => {
      const entry = await apply()

      expect(await store.recordLabels.listForRecord(retroId, 'r-stale-lock')).toEqual([entry])
    })

    /**
     * SQLite has no boolean, so `applied` is a 0/1 column and both directions of
     * the conversion have to be proven — a `false` that came back as `0` would
     * be truthy above L1 and would put every removed label back on.
     */
    test('keeps `applied` a boolean in both directions', async () => {
      await apply({ version: 1, applied: true })
      await apply({ version: 2, applied: false })

      expect(
        (await store.recordLabels.listForRecord(retroId, 'r-stale-lock')).map(
          (entry) => entry.applied,
        ),
      ).toEqual([true, false])
    })

    test('is empty for a record nobody has labelled', async () => {
      expect(await store.recordLabels.listForRecord(retroId, 'r-untouched')).toEqual([])
    })

    /**
     * **Ordered by `id`, not by `version`** — insertion order, which is the only
     * order that means anything across three independent sequences. Written here
     * as two labels interleaved, because a single-label fixture answers the same
     * whichever ordering an adapter chose.
     */
    test('lists a record’s entries in the order they were written', async () => {
      const first = await apply({ labelId: migrated, version: 1, applied: true })
      const second = await apply({ labelId: triage, version: 1, applied: true })
      const third = await apply({ labelId: migrated, version: 2, applied: false })

      expect(
        (await store.recordLabels.listForRecord(retroId, 'r-stale-lock')).map((entry) => entry.id),
      ).toEqual([first.id, second.id, third.id])
    })

    /**
     * **The version in force is per `(record, label)`**, which is the assertion
     * this whole suite exists for. Two labels on one record, each with two
     * versions: an adapter grouping one column short answers with two rows of
     * one label instead of the latest of each.
     */
    test('reports the entry in force for each record-and-label pair', async () => {
      await apply({ labelId: migrated, version: 1, applied: true })
      const migratedNow = await apply({ labelId: migrated, version: 2, applied: false })
      await apply({ labelId: triage, version: 1, applied: false })
      const triageNow = await apply({ labelId: triage, version: 2, applied: true })

      expect(await store.recordLabels.listLatestForEachRecord()).toEqual([migratedNow, triageNow])
    })

    /**
     * **A rid is minted per retrospective**, so the same rid in two
     * retrospectives is two records — and the cross-retro read is the one place
     * an adapter keying on the rid alone would show one record's labels on the
     * other's row.
     */
    test('never lets one retrospective’s record shadow another’s of the same rid', async () => {
      const here = await apply({ retroId, applied: true })
      const there = await apply({ retroId: elsewhere, applied: false })

      expect(await store.recordLabels.listLatestForEachRecord()).toEqual([here, there])
      expect(await store.recordLabels.listForRecord(elsewhere, 'r-stale-lock')).toEqual([there])
    })

    test('lists nothing across a store nobody has labelled', async () => {
      expect(await store.recordLabels.listLatestForEachRecord()).toEqual([])
    })
  })

  describe(`${label} · RecordAttributeValueRepository`, () => {
    let store: Store
    let retroId: number
    let elsewhere: number
    let ticket: number
    let movedOn: number

    beforeEach(async () => {
      store = await makeStore()
      const sessionId = await seedSession(store)
      retroId = await seedRetrospective(store, sessionId)
      elsewhere = await seedRetrospective(store, sessionId)

      const define = async (name: string, type: 'number' | 'date') =>
        (
          await store.attributeDefinitions.add({
            name,
            type,
            retiredAt: undefined,
            createdAt: '2026-09-01T09:00:00.000Z',
          })
        ).id
      ticket = await define('external ticket ID', 'number')
      movedOn = await define('moved on', 'date')
    })

    const set = (
      overrides: Partial<Parameters<Store['recordAttributeValues']['add']>[0]> = {},
    ): Promise<Awaited<ReturnType<Store['recordAttributeValues']['add']>>> =>
      store.recordAttributeValues.add({
        retroId,
        rid: 'r-stale-lock',
        attributeId: ticket,
        version: 1,
        value: '4192',
        at: '2026-09-01T10:00:00.000Z',
        ...overrides,
      })

    test('stores a value and reads it back on the record', async () => {
      const entry = await set()

      expect(await store.recordAttributeValues.listForRecord(retroId, 'r-stale-lock')).toEqual([
        entry,
      ])
    })

    /**
     * **Clearing is a row whose value is absent**, and the absence has to
     * survive the round trip as `undefined` rather than as `''`: "no longer
     * points at a ticket" and "points at the empty string" are different claims,
     * and only the first one is what a clear means.
     */
    test('keeps a cleared value absent rather than empty', async () => {
      await set({ version: 1, value: '4192' })
      await set({ version: 2, value: undefined })

      expect(
        (await store.recordAttributeValues.listForRecord(retroId, 'r-stale-lock')).map(
          (entry) => entry.value,
        ),
      ).toEqual(['4192', undefined])
    })

    test('lists a record’s entries in the order they were written', async () => {
      const first = await set({ attributeId: ticket, version: 1 })
      const second = await set({ attributeId: movedOn, version: 1, value: '2026-09-01' })
      const third = await set({ attributeId: ticket, version: 2, value: undefined })

      expect(
        (await store.recordAttributeValues.listForRecord(retroId, 'r-stale-lock')).map(
          (entry) => entry.id,
        ),
      ).toEqual([first.id, second.id, third.id])
    })

    test('reports the entry in force for each record-and-attribute pair', async () => {
      await set({ attributeId: ticket, version: 1, value: '4192' })
      const ticketNow = await set({ attributeId: ticket, version: 2, value: '5000' })
      const movedNow = await set({ attributeId: movedOn, version: 1, value: '2026-09-01' })

      expect(await store.recordAttributeValues.listLatestForEachRecord()).toEqual([
        ticketNow,
        movedNow,
      ])
    })

    test('never lets one retrospective’s record shadow another’s of the same rid', async () => {
      const here = await set({ retroId, value: '4192' })
      const there = await set({ retroId: elsewhere, value: '7' })

      expect(await store.recordAttributeValues.listLatestForEachRecord()).toEqual([here, there])
    })
  })

  describe(`${label} · SettingRepository`, () => {
    let store: Store

    beforeEach(async () => {
      store = await makeStore()
    })

    /**
     * **No row is the safe state**, and it is a fact about the store rather than
     * about a fixture: nothing inserts a default, so a fresh install answers
     * `undefined` here and `aiConfigWriteEnabled` reads that as off
     * (`config-write.service.ts`).
     */
    test('has nothing to say about a key nobody has set', async () => {
      expect(await store.settings.findLatest('ai_config_write')).toBeUndefined()
    })

    test('reports the highest version as the one in force', async () => {
      await store.settings.add({
        key: 'ai_config_write',
        version: 1,
        value: 'on',
        at: '2026-09-01T09:00:00.000Z',
      })
      const off = await store.settings.add({
        key: 'ai_config_write',
        version: 2,
        value: 'off',
        at: '2026-09-01T10:00:00.000Z',
      })

      expect(await store.settings.findLatest('ai_config_write')).toEqual(off)
    })

    /**
     * The key's CHECK and the `(key, version)` UNIQUE are L1-only, so they are
     * proven in `test/sqlite/definition-constraints.test.ts` rather than here:
     * the memory adapter is arrays and enforces neither, and a shared contract
     * is only worth what both adapters actually pass.
     */
  })
}
