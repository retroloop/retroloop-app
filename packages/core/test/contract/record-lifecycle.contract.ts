import { beforeEach, describe, expect, test } from 'bun:test'
import type { Store } from '#application/ports/store.port'
import type { NewRecordLifecycleEntry } from '#domain/models/record-lifecycle.model'
import { type StoreFactory, seedRetrospective, seedSession } from './store.contract'

/**
 * `RecordLifecycleRepository`, against every adapter (testing.md suite 1).
 *
 * Two things here are new to this table and are what the suite is mostly for: a
 * **JSON column** holding a list, which SQLite stores as text and the memory
 * store holds as an array, and an **actor column**, which no other append-only
 * table has. Both are places the two adapters could disagree without anyone
 * noticing above L1.
 */
export function describeRecordLifecycleRepositoryContract(
  label: string,
  makeStore: StoreFactory,
): void {
  describe(`${label} · RecordLifecycleRepository`, () => {
    let store: Store
    let retroId: number
    let otherRetroId: number

    const anEntry = (
      overrides: Partial<NewRecordLifecycleEntry> = {},
    ): NewRecordLifecycleEntry => ({
      retroId,
      rid: 'r-deploy-blocked',
      version: 1,
      status: 'resolved',
      refs: ['a1b2c3d'],
      note: undefined,
      actor: 'ai',
      at: '2026-08-29T10:00:00.000Z',
      ...overrides,
    })

    beforeEach(async () => {
      store = await makeStore()
      const sessionId = await seedSession(store)
      retroId = await seedRetrospective(store, sessionId)
      otherRetroId = await seedRetrospective(store, sessionId)
    })

    test('stores an entry and reads it back as the version in force', async () => {
      const entry = await store.recordLifecycle.add(
        anEntry({ note: 'Fixed in the release branch.', actor: 'human' }),
      )

      expect(await store.recordLifecycle.findLatest(retroId, 'r-deploy-blocked')).toEqual(entry)
      expect(entry.status).toBe('resolved')
      expect(entry.note).toBe('Fixed in the release branch.')
      expect(entry.actor).toBe('human')
      expect(entry.at).toBe('2026-08-29T10:00:00.000Z')
    })

    /**
     * `refs` is a JSON column in SQLite and a real array in memory, so both
     * directions of the conversion have to be proven — a list that came back as
     * the string `'["a1b2c3d"]'` would render as one long reference on the page
     * and would still be truthy everywhere above L1.
     */
    test('keeps `refs` a list of strings in both directions', async () => {
      const many = await store.recordLifecycle.add(
        anEntry({ refs: ['a1b2c3d', 'https://github.com/o/r/pull/42', 'release/2026-08'] }),
      )

      const read = await store.recordLifecycle.findLatest(retroId, 'r-deploy-blocked')
      expect(read?.refs).toEqual(['a1b2c3d', 'https://github.com/o/r/pull/42', 'release/2026-08'])
      expect(read).toEqual(many)
      // Order is the writer's and is preserved: the first ref is the one they
      // led with, and a reader printing them prints them as given.
      expect(read?.refs[0]).toBe('a1b2c3d')
    })

    /** A reopen carries none, which is the empty array rather than a null column. */
    test('keeps an empty `refs` an empty list, not a missing one', async () => {
      await store.recordLifecycle.add(anEntry({ status: 'reopened', refs: [] }))

      expect((await store.recordLifecycle.findLatest(retroId, 'r-deploy-blocked'))?.refs).toEqual(
        [],
      )
    })

    /**
     * **The widened CHECK, from below.** `status` is constrained in SQLite and
     * unconstrained in memory, so the archive pair is the one kind of value the
     * two adapters could disagree about without anything above L1 noticing: a
     * migration that had not widened the constraint would reject the row here
     * and nowhere else. Every act gets a row, because a CHECK list is only as
     * good as its longest member.
     */
    test('stores every act the domain has, including the archive pair', async () => {
      const acts = ['resolved', 'reopened', 'archived', 'unarchived'] as const

      for (const [index, status] of acts.entries()) {
        const written = await store.recordLifecycle.add(
          anEntry({
            version: index + 1,
            status,
            refs: status === 'resolved' ? ['a1b2c3d'] : [],
            actor: 'human',
          }),
        )
        expect(written.status).toBe(status)
      }

      expect((await store.recordLifecycle.findLatest(retroId, 'r-deploy-blocked'))?.status).toBe(
        'unarchived',
      )
    })

    test('records which actor wrote the entry', async () => {
      await store.recordLifecycle.add(anEntry({ actor: 'ai' }))
      await store.recordLifecycle.add(anEntry({ rid: 'r-other', actor: 'human' }))

      expect((await store.recordLifecycle.findLatest(retroId, 'r-deploy-blocked'))?.actor).toBe(
        'ai',
      )
      expect((await store.recordLifecycle.findLatest(retroId, 'r-other'))?.actor).toBe('human')
    })

    test('returns undefined for a record nobody ever touched', async () => {
      expect(await store.recordLifecycle.findLatest(retroId, 'r-never-touched')).toBeUndefined()
      expect(await store.recordLifecycle.findLatest(404, 'r-deploy-blocked')).toBeUndefined()
    })

    /** Reopening is a row, so "resolved at 10:00, reopened at 11:00" stays readable. */
    test('appends versions, and the highest one is what stands', async () => {
      await store.recordLifecycle.add(anEntry({ version: 1, status: 'resolved' }))
      const reopened = await store.recordLifecycle.add(
        anEntry({
          version: 2,
          status: 'reopened',
          refs: [],
          note: 'The lock came back on Tuesday.',
          actor: 'human',
          at: '2026-08-30T11:00:00.000Z',
        }),
      )

      expect(await store.recordLifecycle.findLatest(retroId, 'r-deploy-blocked')).toEqual(reopened)
      expect(await store.recordLifecycle.listLatestForEachRecord()).toEqual([reopened])
    })

    test('lists the version in force for every record that has one, across retrospectives', async () => {
      await store.recordLifecycle.add(anEntry({ version: 1, status: 'resolved' }))
      const standing = await store.recordLifecycle.add(anEntry({ version: 2, status: 'reopened' }))
      const elsewhere = await store.recordLifecycle.add(
        anEntry({ retroId: otherRetroId, rid: 'r-silent-tailer', actor: 'human' }),
      )

      expect(await store.recordLifecycle.listLatestForEachRecord()).toEqual([standing, elsewhere])
    })

    /**
     * **The reason the key is `(retroId, rid)`.** A rid is minted per
     * retrospective and is not globally unique (`record.model.ts`), so the same
     * slug in two retrospectives is two different records — and a cross-retro
     * listing is exactly where keying on the rid alone would show one record's
     * resolution on the other's row.
     */
    test('never lets one retrospective’s rid shadow the same rid in another', async () => {
      const here = await store.recordLifecycle.add(anEntry({ rid: 'r-flaky-test', actor: 'ai' }))
      const there = await store.recordLifecycle.add(
        anEntry({
          retroId: otherRetroId,
          rid: 'r-flaky-test',
          status: 'reopened',
          refs: [],
          actor: 'human',
        }),
      )

      expect(await store.recordLifecycle.findLatest(retroId, 'r-flaky-test')).toEqual(here)
      expect(await store.recordLifecycle.findLatest(otherRetroId, 'r-flaky-test')).toEqual(there)
      expect(await store.recordLifecycle.listLatestForEachRecord()).toEqual([here, there])
    })

    /** Versions are numbered per record, so two records both carrying v1 and v2 must not collide. */
    test('never lets one record’s versions shadow another’s', async () => {
      await store.recordLifecycle.add(anEntry({ version: 1 }))
      const here = await store.recordLifecycle.add(
        anEntry({ version: 2, status: 'reopened', refs: [] }),
      )
      await store.recordLifecycle.add(anEntry({ rid: 'r-silent-tailer', version: 1 }))
      const there = await store.recordLifecycle.add(
        anEntry({ rid: 'r-silent-tailer', version: 2, note: 'Second fix, same record.' }),
      )

      expect(await store.recordLifecycle.findLatest(retroId, 'r-deploy-blocked')).toEqual(here)
      expect(await store.recordLifecycle.findLatest(retroId, 'r-silent-tailer')).toEqual(there)
    })

    test('lists nothing on a store where no record was ever touched', async () => {
      expect(await store.recordLifecycle.listLatestForEachRecord()).toEqual([])
      expect(await store.recordLifecycle.listForRecord(retroId, 'r-deploy-blocked')).toEqual([])
    })

    /**
     * **The whole history of one record, which is what the table was
     * append-only for** — the record page's timeline. Until it
     * existed, every reader of this table asked only for the version in force,
     * so "resolved on the 29th citing abc123, reopened on the 30th" was stored
     * and unreadable.
     *
     * Oldest first by `version`, not by `id`: `version` is the order the acts
     * were taken in per record, and it is the column the store's own uniqueness
     * is on. The rows below are written **out of version order on purpose** —
     * a second record's act is interleaved between this one's — so an adapter
     * that leaned on insertion order would come back with them shuffled.
     */
    test('lists every act ever taken on one record, oldest first', async () => {
      const resolved = await store.recordLifecycle.add(
        anEntry({ version: 1, status: 'resolved', refs: ['a1b2c3d'], actor: 'ai' }),
      )
      await store.recordLifecycle.add(anEntry({ rid: 'r-silent-tailer', version: 1 }))
      const reopened = await store.recordLifecycle.add(
        anEntry({
          version: 2,
          status: 'reopened',
          refs: [],
          note: 'The lock came back on Tuesday.',
          actor: 'human',
          at: '2026-08-30T11:00:00.000Z',
        }),
      )
      const archived = await store.recordLifecycle.add(
        anEntry({
          version: 3,
          status: 'archived',
          refs: [],
          actor: 'human',
          at: '2026-08-31T08:30:00.000Z',
        }),
      )

      expect(await store.recordLifecycle.listForRecord(retroId, 'r-deploy-blocked')).toEqual([
        resolved,
        reopened,
        archived,
      ])
    })

    /** The same `(retroId, rid)` key, on the read that returns more than one row. */
    test('never lets one retrospective’s history answer for another’s same rid', async () => {
      const here = await store.recordLifecycle.add(anEntry({ rid: 'r-flaky-test', actor: 'ai' }))
      const there = await store.recordLifecycle.add(
        anEntry({
          retroId: otherRetroId,
          rid: 'r-flaky-test',
          status: 'reopened',
          refs: [],
          actor: 'human',
        }),
      )

      expect(await store.recordLifecycle.listForRecord(retroId, 'r-flaky-test')).toEqual([here])
      expect(await store.recordLifecycle.listForRecord(otherRetroId, 'r-flaky-test')).toEqual([
        there,
      ])
    })
  })
}
