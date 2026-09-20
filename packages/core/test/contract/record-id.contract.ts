import { beforeEach, describe, expect, test } from 'bun:test'
import type { Store } from '#application/ports/store.port'
import { type StoreFactory, seedRetrospective, seedSession } from './store.contract'

/**
 * The global record sequence, against every adapter (testing.md suite 1).
 *
 * What is being proved here is the thing types cannot say: that the numbers come
 * out **1, 2, 3 in minting order**, that a `(retroId, rid)` cannot be minted
 * twice, and that a unit of work which rolls back does not leave a hole in the
 * sequence. SQLite gets those from `AUTOINCREMENT` and a `UNIQUE` constraint;
 * the memory adapter counts its own rows. Two mechanisms, one behaviour — and
 * the value is a number a human reads off a page and cites back, so "close
 * enough" is not a standard this one can be held to.
 */
export function describeRecordIdRepositoryContract(label: string, makeStore: StoreFactory): void {
  describe(`${label} · RecordIdRepository`, () => {
    let store: Store
    let here: number
    let there: number

    beforeEach(async () => {
      store = await makeStore()
      const sessionId = await seedSession(store)
      here = await seedRetrospective(store, sessionId)
      there = await seedRetrospective(store, sessionId)
    })

    test('mints one dense sequence in the order the records were minted', async () => {
      expect((await store.recordIds.add({ retroId: here, rid: 'r-one' })).id).toBe(1)
      expect((await store.recordIds.add({ retroId: here, rid: 'r-two' })).id).toBe(2)
      // The next retrospective continues the same sequence rather than starting
      // its own — which is the whole ask (`record-id.model.ts`).
      expect((await store.recordIds.add({ retroId: there, rid: 'r-three' })).id).toBe(3)
    })

    /**
     * A rid is minted per retrospective, so the same one names two different
     * records. They are two records and they get two numbers — the one property
     * that makes a global id usable as an address at all.
     */
    test('gives the same rid in two retrospectives two different numbers', async () => {
      const first = await store.recordIds.add({ retroId: here, rid: 'r-stale-lock' })
      const second = await store.recordIds.add({ retroId: there, rid: 'r-stale-lock' })

      expect(second.id).not.toBe(first.id)
      expect(await store.recordIds.findByRecord(there, 'r-stale-lock')).toEqual(second)
    })

    /**
     * Insert-only, and stricter than the append-only tables beside it: those take
     * a new version, this takes nothing at all. A second row for one record would
     * be the store holding two answers to "which record is this".
     */
    test('refuses to mint a second number for a record that has one', async () => {
      await store.recordIds.add({ retroId: here, rid: 'r-one' })

      await expect(store.recordIds.add({ retroId: here, rid: 'r-one' })).rejects.toThrow()
      expect(await store.recordIds.listByRetro(here)).toHaveLength(1)
    })

    test('a miss returns undefined rather than throwing', async () => {
      expect(await store.recordIds.findByRecord(here, 'r-never-filed')).toBeUndefined()
      expect(await store.recordIds.findById(1)).toBeUndefined()
      expect(await store.recordIds.listByRetro(here)).toEqual([])
      expect(await store.recordIds.listAll()).toEqual([])
    })

    /**
     * The sequence, run backwards — the resolver behind `/records/:id`. It is
     * the one read on this repository whose argument is a number a human typed,
     * so it is the one that will routinely be asked about a record that is not
     * there.
     *
     * The two rids are minted in two retrospectives on purpose: a lookup that
     * matched on the row's position, or forgot which retrospective it came out
     * of, would answer the same for both and the page would open the wrong
     * record under the right number.
     */
    test('resolves a global number back to the pair that actually addresses the record', async () => {
      const first = await store.recordIds.add({ retroId: here, rid: 'r-stale-lock' })
      const second = await store.recordIds.add({ retroId: there, rid: 'r-stale-lock' })

      expect(await store.recordIds.findById(first.id)).toEqual(first)
      expect(await store.recordIds.findById(second.id)).toEqual(second)
      expect((await store.recordIds.findById(second.id))?.retroId).toBe(there)
    })

    test('a number nothing was minted for resolves to nothing', async () => {
      await store.recordIds.add({ retroId: here, rid: 'r-one' })

      expect(await store.recordIds.findById(2)).toBeUndefined()
      expect(await store.recordIds.findById(9_999)).toBeUndefined()
    })

    test('lists one retrospective’s numbers, and every retrospective’s, ascending', async () => {
      await store.recordIds.add({ retroId: here, rid: 'r-one' })
      await store.recordIds.add({ retroId: there, rid: 'r-two' })
      await store.recordIds.add({ retroId: here, rid: 'r-three' })

      expect((await store.recordIds.listByRetro(here)).map((row) => [row.id, row.rid])).toEqual([
        [1, 'r-one'],
        [3, 'r-three'],
      ])
      expect((await store.recordIds.listAll()).map((row) => [row.retroId, row.id])).toEqual([
        [here, 1],
        [there, 2],
        [here, 3],
      ])
    })

    /**
     * The sequence is transactional in both stores, which is not obvious in
     * either: SQLite keeps `AUTOINCREMENT`'s high-water mark in an ordinary table
     * that rolls back with everything else, and the memory adapter counts rows in
     * an array the snapshot `tx` restores. A store where a refused revision burnt
     * a number would leave a gap in the one sequence the product shows a human.
     */
    test('a unit of work that rolls back consumes no number', async () => {
      await store.recordIds.add({ retroId: here, rid: 'r-one' })

      const failure = store.tx(async (repositories) => {
        await repositories.recordIds.add({ retroId: here, rid: 'r-abandoned' })
        throw new Error('the revision was refused after minting')
      })
      await expect(failure).rejects.toThrow('the revision was refused after minting')

      expect((await store.recordIds.add({ retroId: here, rid: 'r-two' })).id).toBe(2)
      expect((await store.recordIds.listAll()).map((row) => row.rid)).toEqual(['r-one', 'r-two'])
    })
  })
}
