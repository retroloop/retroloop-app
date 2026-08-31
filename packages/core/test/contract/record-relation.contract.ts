import { beforeEach, describe, expect, test } from 'bun:test'
import type { Store } from '#application/ports/store.port'
import { type StoreFactory, seedRetrospective, seedSession } from './store.contract'

/**
 * Which records somebody said belong together, against every adapter
 * (testing.md suite 1) — `record_relations`.
 *
 * Two properties are worth a contract suite of their own, and both are places an
 * adapter could be quietly wrong while passing every type check:
 *
 * 1. **`listForRecord` reads both columns.** The row is directed as authored and
 *    is never mirrored, so *"the relation reads from both sides"* is true only
 *    because this read asks about `from_id` **or** `to_id`. An adapter that read
 *    one column would answer correctly on the record the relation was authored
 *    from and silently show nothing on the other.
 * 2. **Versions are dense per ordered pair.** A record holding three relations
 *    holds three independent `version: 1` rows, so an adapter grouping by the
 *    record — or by an unordered pair — would read one relation's history as
 *    another's.
 */
export function describeRecordRelationRepositoryContract(
  label: string,
  makeStore: StoreFactory,
): void {
  describe(`${label} · RecordRelationRepository`, () => {
    let store: Store
    /** Three minted numbers, the third in a second retrospective. */
    let first: number
    let second: number
    let elsewhere: number

    beforeEach(async () => {
      store = await makeStore()
      const sessionId = await seedSession(store)
      const retroId = await seedRetrospective(store, sessionId)
      const otherRetroId = await seedRetrospective(store, sessionId)

      first = (await store.recordIds.add({ retroId, rid: 'r-stale-lock' })).id
      second = (await store.recordIds.add({ retroId, rid: 'r-silent-tailer' })).id
      elsewhere = (await store.recordIds.add({ retroId: otherRetroId, rid: 'r-stale-lock' })).id
    })

    const relate = (
      overrides: Partial<Parameters<Store['recordRelations']['add']>[0]> = {},
    ): Promise<Awaited<ReturnType<Store['recordRelations']['add']>>> =>
      store.recordRelations.add({
        fromId: first,
        toId: second,
        version: 1,
        applied: true,
        how: 'supersedes',
        actor: 'ai',
        at: '2026-09-01T10:00:00.000Z',
        ...overrides,
      })

    test('stores an entry and reads it back from the side it was authored from', async () => {
      const entry = await relate()

      expect(entry.id).toBeGreaterThan(0)
      expect(await store.recordRelations.listForRecord(first)).toEqual([entry])
    })

    /** The claim the whole feature rests on: one row, two readers. */
    test('and from the other side too — one row, both ends', async () => {
      const entry = await relate()

      expect(await store.recordRelations.listForRecord(second)).toEqual([entry])
    })

    test('a record with no relations reads as an empty list, not a miss', async () => {
      expect(await store.recordRelations.listForRecord(elsewhere)).toEqual([])
    })

    /**
     * `applied: false` has to survive the round trip: SQLite has no boolean, so
     * a `false` that came back as `0` would be truthy above L1 and would put
     * every un-related pair back together.
     */
    test('keeps the bit and the words the un-relate row carries forward', async () => {
      await relate({ how: 'duplicates' })
      await relate({ version: 2, applied: false, how: 'duplicates', actor: 'human' })

      expect(
        (await store.recordRelations.listForRecord(first)).map((entry) => [
          entry.version,
          entry.applied,
          entry.how,
          entry.actor,
        ]),
      ).toEqual([
        [1, true, 'duplicates', 'ai'],
        [2, false, 'duplicates', 'human'],
      ])
    })

    /**
     * Insertion order, which is the only order that means anything across three
     * independent version sequences — the reason both adapters order by `id`
     * rather than by `version`.
     */
    test('reads a record’s whole history in insertion order across pairs', async () => {
      const supersedes = await relate({ fromId: first, toId: second })
      const crossRetro = await relate({ fromId: first, toId: elsewhere, how: 'the same lock' })
      const incoming = await relate({ fromId: second, toId: first, how: 'was superseded by' })

      expect((await store.recordRelations.listForRecord(first)).map((entry) => entry.id)).toEqual([
        supersedes.id,
        crossRetro.id,
        incoming.id,
      ])
    })

    /** A relation belongs to no retrospective — which is the point of it. */
    test('relates records across two retrospectives', async () => {
      const entry = await relate({ fromId: elsewhere, toId: first, how: 'the same lock again' })

      expect(await store.recordRelations.listForRecord(elsewhere)).toEqual([entry])
      expect(await store.recordRelations.listForRecord(first)).toEqual([entry])
    })

    describe('the entry in force for each pair', () => {
      test('is the highest version of that ordered pair, and no other', async () => {
        await relate({ version: 1, applied: true })
        const latest = await relate({ version: 2, applied: false })
        const otherPair = await relate({ fromId: first, toId: elsewhere, how: 'the same lock' })

        expect(await store.recordRelations.listLatestForEachPair()).toEqual([latest, otherPair])
      })

      /**
       * `(#1, #2)` and `(#2, #1)` are two statements with two sequences, so both
       * appear — an adapter that grouped on an unordered pair would drop one.
       */
      test('treats the reverse pair as a sequence of its own', async () => {
        const forwards = await relate({ fromId: first, toId: second })
        const backwards = await relate({
          fromId: second,
          toId: first,
          how: 'was superseded by',
          actor: 'human',
        })

        expect(await store.recordRelations.listLatestForEachPair()).toEqual([forwards, backwards])
      })

      test('is empty on a store nobody has related anything in', async () => {
        expect(await store.recordRelations.listLatestForEachPair()).toEqual([])
      })
    })
  })
}
