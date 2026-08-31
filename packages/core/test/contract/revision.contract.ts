import { beforeEach, describe, expect, test } from 'bun:test'
import type { Store } from '#application/ports/store.port'
import type { RetroRecord } from '#domain/models/record.model'
import type { NewRevision } from '#domain/models/revision.model'
import { aLegacyRecord, aRecord } from '../support/fixtures'
import { type StoreFactory, seedRetrospective, seedSession } from './store.contract'

export function describeRevisionRepositoryContract(label: string, makeStore: StoreFactory): void {
  describe(`${label} · RevisionRepository`, () => {
    let store: Store
    let retroId: number
    let otherRetroId: number

    const aNewRevision = (
      n: number,
      records: readonly RetroRecord[] = [aRecord()],
    ): NewRevision => ({
      retroId,
      n,
      createdAt: '2026-08-23T09:00:00.000Z',
      title: undefined,
      records,
    })

    beforeEach(async () => {
      store = await makeStore()
      const sessionId = await seedSession(store)
      retroId = await seedRetrospective(store, sessionId)
      otherRetroId = await seedRetrospective(store, sessionId)
    })

    test('stores a revision with its embedded records', async () => {
      const revision = await store.revisions.add(aNewRevision(1))

      expect(revision.records).toHaveLength(1)
      expect(await store.revisions.findByRetroAndN(retroId, 1)).toEqual(revision)
    })

    test('round-trips every field of an embedded record', async () => {
      const record = aRecord({
        humanWords: [{ verbatim: 'as spoken', cleaned: 'As spoken.', context: undefined }],
        defaults: { severity: 5, involvement: 'other' },
      })
      await store.revisions.add(aNewRevision(1, [record]))

      expect((await store.revisions.findByRetroAndN(retroId, 1))?.records[0]).toEqual(record)
    })

    /**
     * The old shape, byte for byte — including the `upstream` level KC-0021 cut
     * and the two narrative fields nothing authors any more. A store that
     * dropped or reshaped any of it on the way through would take the owner's
     * five retrospectives with it.
     */
    test('round-trips a record filed before solutions existed', async () => {
      const record = aLegacyRecord({
        defaults: { severity: 5, solutionLevel: 'upstream', involvement: 'other' },
      })
      await store.revisions.add(aNewRevision(2, [record]))

      const read = (await store.revisions.findByRetroAndN(retroId, 2))?.records[0]
      expect(read).toEqual(record)
      expect(read?.solutions).toBeUndefined()
    })

    /**
     * The retrospective's name rides on the revision that proposed it (KC-0020).
     * A revision filed before titles existed has none, and both stores have to
     * say so as `undefined` — never as an empty string, which would render as a
     * retro whose name is a blank.
     */
    test('round-trips a title, and an absent one, in both directions', async () => {
      const named = await store.revisions.add({
        ...aNewRevision(1),
        title: 'The lock file that outlived its process',
      })
      const unnamed = await store.revisions.add(aNewRevision(2))

      expect(named.title).toBe('The lock file that outlived its process')
      expect(unnamed.title).toBeUndefined()
      expect(await store.revisions.findByRetroAndN(retroId, 1)).toEqual(named)
      expect(await store.revisions.findByRetroAndN(retroId, 2)).toEqual(unnamed)
      expect((await store.revisions.listByRetro(retroId)).map((one) => one.title)).toEqual([
        'The lock file that outlived its process',
        undefined,
      ])
      expect((await store.revisions.findLatestByRetro(retroId))?.title).toBeUndefined()
    })

    test('returns undefined for a miss', async () => {
      expect(await store.revisions.findByRetroAndN(retroId, 9)).toBeUndefined()
      expect(await store.revisions.findLatestByRetro(404)).toBeUndefined()
    })

    test('lists ascending by n, finds the latest and counts', async () => {
      await store.revisions.add(aNewRevision(1))
      await store.revisions.add(aNewRevision(2))
      await store.revisions.add({ ...aNewRevision(1), retroId: otherRetroId })

      expect((await store.revisions.listByRetro(retroId)).map((revision) => revision.n)).toEqual([
        1, 2,
      ])
      expect((await store.revisions.findLatestByRetro(retroId))?.n).toBe(2)
      expect(await store.revisions.countByRetro(retroId)).toBe(2)
      expect(await store.revisions.countByRetro(404)).toBe(0)
    })

    /**
     * What the dashboard reads: the newest draft of every retrospective in one
     * go, because the retro's name and its record counts both come from it
     * (KC-0020). A retrospective with no revision is simply absent — it has no
     * latest draft to report, and inventing an empty one would give it a name.
     */
    test('finds the latest revision of every retrospective at once', async () => {
      await store.revisions.add(aNewRevision(1))
      const latestHere = await store.revisions.add({
        ...aNewRevision(2),
        title: 'The second draft',
      })
      const onlyThere = await store.revisions.add({ ...aNewRevision(1), retroId: otherRetroId })

      expect(await store.revisions.listLatestForEachRetro()).toEqual([latestHere, onlyThere])
    })

    test('finds nothing across retrospectives that have no revisions', async () => {
      expect(await store.revisions.listLatestForEachRetro()).toEqual([])
    })

    test('is immutable in practice: the stored records are not the caller’s array', async () => {
      const records = [aRecord()]
      const revision = await store.revisions.add(aNewRevision(1, records))
      Object.assign(records[0] as { title: string }, { title: 'tampered after the write' })

      expect((await store.revisions.findByRetroAndN(retroId, 1))?.records[0]?.title).toBe(
        revision.records[0]?.title,
      )
    })
  })
}
