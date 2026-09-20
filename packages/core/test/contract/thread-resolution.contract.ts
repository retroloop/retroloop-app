import { beforeEach, describe, expect, test } from 'bun:test'
import type { Store } from '#application/ports/store.port'
import type { NewThreadResolution } from '#domain/models/thread-resolution.model'
import { type StoreFactory, seedRetrospective, seedSession } from './store.contract'

export function describeThreadResolutionRepositoryContract(
  label: string,
  makeStore: StoreFactory,
): void {
  describe(`${label} · ThreadResolutionRepository`, () => {
    let store: Store
    let threadId: number
    let otherThreadId: number
    let untouchedThreadId: number

    const aNewResolution = (overrides: Partial<NewThreadResolution> = {}): NewThreadResolution => ({
      threadId,
      version: 1,
      resolved: true,
      at: '2026-08-27T10:00:00.000Z',
      ...overrides,
    })

    beforeEach(async () => {
      store = await makeStore()
      const sessionId = await seedSession(store)
      const retroId = await seedRetrospective(store, sessionId)

      const opened = async (section: 'problem' | 'direction' | 'footprint') =>
        (
          await store.threads.addThread({
            retroId,
            rid: 'r-deploy-blocked',
            section,
            openedAt: '2026-08-27T09:00:00.000Z',
          })
        ).id

      threadId = await opened('problem')
      otherThreadId = await opened('direction')
      untouchedThreadId = await opened('footprint')
    })

    test('stores a resolution and reads it back as the version in force', async () => {
      const resolution = await store.threadResolutions.add(aNewResolution())

      expect(await store.threadResolutions.findLatest(threadId)).toEqual(resolution)
      expect(resolution.resolved).toBe(true)
      expect(resolution.at).toBe('2026-08-27T10:00:00.000Z')
    })

    /**
     * SQLite has no boolean, so `resolved` is a 0/1 column and both directions of
     * the conversion have to be proven — a `false` that came back as `0` would be
     * truthy everywhere above L1 and would collapse every thread on the page.
     */
    test('keeps `resolved` a boolean in both directions', async () => {
      await store.threadResolutions.add(aNewResolution({ resolved: true }))
      await store.threadResolutions.add(
        aNewResolution({ threadId: otherThreadId, resolved: false }),
      )

      expect((await store.threadResolutions.findLatest(threadId))?.resolved).toBe(true)
      expect((await store.threadResolutions.findLatest(otherThreadId))?.resolved).toBe(false)
    })

    test('returns undefined for a thread nobody ever marked', async () => {
      expect(await store.threadResolutions.findLatest(untouchedThreadId)).toBeUndefined()
      expect(await store.threadResolutions.findLatest(404)).toBeUndefined()
    })

    /** Reopening is a row, so "resolved at 10:00, reopened at 11:00" stays readable. */
    test('appends versions, and the highest one is what stands', async () => {
      await store.threadResolutions.add(aNewResolution({ version: 1, resolved: true }))
      const reopened = await store.threadResolutions.add(
        aNewResolution({ version: 2, resolved: false, at: '2026-08-27T11:00:00.000Z' }),
      )

      expect(await store.threadResolutions.findLatest(threadId)).toEqual(reopened)
      expect(await store.threadResolutions.listLatestForThreads([threadId])).toEqual([reopened])
    })

    test('returns the version in force for each thread asked about, and only those', async () => {
      await store.threadResolutions.add(aNewResolution({ version: 1, resolved: true }))
      const standing = await store.threadResolutions.add(
        aNewResolution({ version: 2, resolved: false }),
      )
      const other = await store.threadResolutions.add(
        aNewResolution({ threadId: otherThreadId, resolved: true }),
      )

      expect(
        await store.threadResolutions.listLatestForThreads([
          threadId,
          otherThreadId,
          untouchedThreadId,
        ]),
      ).toEqual([standing, other])
      expect(await store.threadResolutions.listLatestForThreads([otherThreadId])).toEqual([other])
    })

    /**
     * Versions are numbered per thread, so two threads both carrying a v1 and a
     * v2 must not shadow each other.
     */
    test('never lets one thread’s versions shadow another’s', async () => {
      await store.threadResolutions.add(aNewResolution({ version: 1, resolved: true }))
      const here = await store.threadResolutions.add(
        aNewResolution({ version: 2, resolved: false }),
      )
      await store.threadResolutions.add(
        aNewResolution({ threadId: otherThreadId, version: 1, resolved: false }),
      )
      const there = await store.threadResolutions.add(
        aNewResolution({ threadId: otherThreadId, version: 2, resolved: true }),
      )

      expect(await store.threadResolutions.findLatest(threadId)).toEqual(here)
      expect(await store.threadResolutions.findLatest(otherThreadId)).toEqual(there)
    })

    test('lists nothing when asked about nothing', async () => {
      await store.threadResolutions.add(aNewResolution())

      expect(await store.threadResolutions.listLatestForThreads([])).toEqual([])
      expect(await store.threadResolutions.listLatestForThreads([404])).toEqual([])
    })
  })
}
