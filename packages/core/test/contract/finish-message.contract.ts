import { beforeEach, describe, expect, test } from 'bun:test'
import type { Store } from '#application/ports/store.port'
import type { NewFinishMessage } from '#domain/models/finish-message.model'
import { type StoreFactory, seedRetrospective, seedSession } from './store.contract'

export function describeFinishMessageRepositoryContract(
  label: string,
  makeStore: StoreFactory,
): void {
  describe(`${label} · FinishMessageRepository`, () => {
    let store: Store
    let retroId: number
    let otherRetroId: number

    const aNewMessage = (overrides: Partial<NewFinishMessage> = {}): NewFinishMessage => ({
      retroId,
      revisionN: 1,
      version: 1,
      message: 'Ship the first two; the third can wait for next week.',
      at: '2026-08-28T10:00:00.000Z',
      ...overrides,
    })

    beforeEach(async () => {
      store = await makeStore()
      const sessionId = await seedSession(store)
      retroId = await seedRetrospective(store, sessionId)
      otherRetroId = await seedRetrospective(store, sessionId)
    })

    test('stores a message and reads it back as the version in force for that round', async () => {
      const stored = await store.finishMessages.add(aNewMessage())

      expect(await store.finishMessages.findLatest(retroId, 1)).toEqual(stored)
      expect(stored.message).toBe('Ship the first two; the third can wait for next week.')
      expect(stored.at).toBe('2026-08-28T10:00:00.000Z')
    })

    test('returns undefined for a round he left no word on', async () => {
      await store.finishMessages.add(aNewMessage())

      expect(await store.finishMessages.findLatest(retroId, 2)).toBeUndefined()
      expect(await store.finishMessages.findLatest(otherRetroId, 1)).toBeUndefined()
      expect(await store.finishMessages.findLatest(404, 1)).toBeUndefined()
    })

    /**
     * The grain is the round, so round 2's word does not replace round 1's and
     * does not hide it: a retrospective that went three rounds has three of
     * these, and the export carries them all.
     */
    test('keeps one message per round, and lists them in revision order', async () => {
      const second = await store.finishMessages.add(
        aNewMessage({ revisionN: 2, message: 'Better. Two small things in the comments.' }),
      )
      const first = await store.finishMessages.add(aNewMessage({ revisionN: 1 }))

      expect(await store.finishMessages.findLatest(retroId, 1)).toEqual(first)
      expect(await store.finishMessages.findLatest(retroId, 2)).toEqual(second)
      expect(await store.finishMessages.listLatestByRetro(retroId)).toEqual([first, second])
    })

    /** Append-only and versioned: a later version stands, and the first one stays. */
    test('appends versions per round, and the highest one is what stands', async () => {
      await store.finishMessages.add(aNewMessage({ version: 1, message: 'First word.' }))
      const amended = await store.finishMessages.add(
        aNewMessage({ version: 2, message: 'Second word.', at: '2026-08-28T11:00:00.000Z' }),
      )

      expect(await store.finishMessages.findLatest(retroId, 1)).toEqual(amended)
      expect(await store.finishMessages.listLatestByRetro(retroId)).toEqual([amended])
    })

    /** Versions are numbered per round, so two rounds both carrying a v1 must not shadow each other. */
    test('never lets one round’s versions shadow another’s', async () => {
      await store.finishMessages.add(aNewMessage({ revisionN: 1, version: 1, message: 'Round 1.' }))
      const here = await store.finishMessages.add(
        aNewMessage({ revisionN: 1, version: 2, message: 'Round 1, again.' }),
      )
      const there = await store.finishMessages.add(
        aNewMessage({ revisionN: 2, version: 1, message: 'Round 2.' }),
      )

      expect(await store.finishMessages.findLatest(retroId, 1)).toEqual(here)
      expect(await store.finishMessages.findLatest(retroId, 2)).toEqual(there)
      expect(await store.finishMessages.listLatestByRetro(retroId)).toEqual([here, there])
    })

    test('lists only the retrospective asked about, and nothing for one with no rounds', async () => {
      const mine = await store.finishMessages.add(aNewMessage())
      const theirs = await store.finishMessages.add(
        aNewMessage({ retroId: otherRetroId, message: 'A word on the other review.' }),
      )

      expect(await store.finishMessages.listLatestByRetro(retroId)).toEqual([mine])
      expect(await store.finishMessages.listLatestByRetro(otherRetroId)).toEqual([theirs])
      expect(await store.finishMessages.listLatestByRetro(404)).toEqual([])
    })
  })
}
