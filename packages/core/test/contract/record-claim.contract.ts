import { beforeEach, describe, expect, test } from 'bun:test'
import type { Store } from '#application/ports/store.port'
import type { NewRecordClaimEntry } from '#domain/models/record-claim.model'
import { type StoreFactory, seedRetrospective, seedSession } from './store.contract'

/**
 * `RecordClaimRepository`, against every adapter (testing.md suite 1).
 *
 * Two properties are worth a contract suite of their own, and both are places an
 * adapter could be quietly wrong while passing every type check:
 *
 * 1. **The bit survives the round trip.** SQLite has no boolean, so `claimed` is
 *    a 0/1 column; a `false` that came back as the number `0` would be truthy
 *    above L1 and would leave every released record looking held.
 * 2. **The key is the pair, never the rid.** A rid is minted per retrospective,
 *    so `r-stale-lock` in two retrospectives is two records with two sequences —
 *    an adapter keyed on the rid alone would show one record's claim on the
 *    other's row, which on this table means an agent refusing to pick up a
 *    record nobody is holding.
 */
export function describeRecordClaimRepositoryContract(
  label: string,
  makeStore: StoreFactory,
): void {
  describe(`${label} · RecordClaimRepository`, () => {
    let store: Store
    let retroId: number
    let otherRetroId: number

    const anEntry = (overrides: Partial<NewRecordClaimEntry> = {}): NewRecordClaimEntry => ({
      retroId,
      rid: 'r-stale-lock',
      version: 1,
      claimed: true,
      actor: 'ai',
      at: '2026-09-13T10:00:00.000Z',
      ...overrides,
    })

    beforeEach(async () => {
      store = await makeStore()
      const sessionId = await seedSession(store)
      retroId = await seedRetrospective(store, sessionId)
      otherRetroId = await seedRetrospective(store, sessionId)
    })

    test('stores a claim and reads it back as the version in force', async () => {
      const entry = await store.recordClaims.add(anEntry())

      expect(entry.id).toBeGreaterThan(0)
      expect(await store.recordClaims.findLatest(retroId, 'r-stale-lock')).toEqual(entry)
      expect(entry.claimed).toBe(true)
      expect(entry.actor).toBe('ai')
      expect(entry.at).toBe('2026-09-13T10:00:00.000Z')
    })

    /** The half a 0/1 column gets wrong: `false` has to come back `false`. */
    test('keeps the bit in both directions, and the actor that wrote each row', async () => {
      await store.recordClaims.add(anEntry())
      await store.recordClaims.add(anEntry({ version: 2, claimed: false, actor: 'human' }))

      const latest = await store.recordClaims.findLatest(retroId, 'r-stale-lock')
      expect(latest?.claimed).toBe(false)
      expect(latest?.claimed).not.toBe(0)
      expect(latest?.actor).toBe('human')
    })

    test('a record nobody has claimed reads as a miss, not as a released claim', async () => {
      expect(await store.recordClaims.findLatest(retroId, 'r-never-touched')).toBeUndefined()
    })

    test('findLatest is the highest version, whatever order the rows went in', async () => {
      await store.recordClaims.add(anEntry({ version: 1, claimed: true }))
      await store.recordClaims.add(anEntry({ version: 2, claimed: false }))
      const third = await store.recordClaims.add(anEntry({ version: 3, claimed: true }))

      expect(await store.recordClaims.findLatest(retroId, 'r-stale-lock')).toEqual(third)
    })

    describe('the claim in force for each record', () => {
      test('keys on the pair, so the same rid in two retrospectives stays two records', async () => {
        const here = await store.recordClaims.add(anEntry())
        const there = await store.recordClaims.add(
          anEntry({ retroId: otherRetroId, actor: 'human' }),
        )

        expect(await store.recordClaims.listLatestForEachRecord()).toEqual([here, there])
      })

      test('is the highest version of each record, and no other', async () => {
        await store.recordClaims.add(anEntry({ version: 1 }))
        const latest = await store.recordClaims.add(anEntry({ version: 2, claimed: false }))
        const otherRecord = await store.recordClaims.add(anEntry({ rid: 'r-silent-tailer' }))

        expect(await store.recordClaims.listLatestForEachRecord()).toEqual([latest, otherRecord])
      })

      /**
       * A released claim is still the entry in force — reading it is how the
       * caller tells "nobody is holding this" from "nobody has ever held it",
       * and it is what the next claim numbers itself after.
       */
      test('carries a released claim rather than dropping the record', async () => {
        await store.recordClaims.add(anEntry({ version: 1 }))
        await store.recordClaims.add(anEntry({ version: 2, claimed: false }))

        expect(
          (await store.recordClaims.listLatestForEachRecord()).map((entry) => [
            entry.rid,
            entry.version,
            entry.claimed,
          ]),
        ).toEqual([['r-stale-lock', 2, false]])
      })

      test('is empty on a store nobody has claimed anything in', async () => {
        expect(await store.recordClaims.listLatestForEachRecord()).toEqual([])
      })
    })
  })
}
