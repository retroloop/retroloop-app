import { beforeEach, describe, expect, test } from 'bun:test'
import type { Store } from '#application/ports/store.port'
import type { NewRetrospective } from '#domain/models/retrospective.model'
import { type StoreFactory, seedSession } from './store.contract'

export function describeRetrospectiveRepositoryContract(
  label: string,
  makeStore: StoreFactory,
): void {
  describe(`${label} · RetrospectiveRepository`, () => {
    let store: Store
    let sessionId: number

    const aNewRetrospective = (overrides: Partial<NewRetrospective> = {}): NewRetrospective => ({
      sessionId,
      state: 'open',
      startedAt: '2026-08-23T09:00:00.000Z',
      finishedAt: undefined,
      ...overrides,
    })

    beforeEach(async () => {
      store = await makeStore()
      sessionId = await seedSession(store)
    })

    test('stores a retrospective and reads it back by id', async () => {
      const retro = await store.retrospectives.add(aNewRetrospective())

      expect(await store.retrospectives.findById(retro.id)).toEqual(retro)
    })

    test('returns undefined for a miss', async () => {
      expect(await store.retrospectives.findById(404)).toBeUndefined()
      expect(await store.retrospectives.findOpenBySession(404)).toBeUndefined()
      expect(await store.retrospectives.findLatestBySession(404)).toBeUndefined()
    })

    test('lists a session oldest first and finds the latest', async () => {
      const first = await store.retrospectives.add(aNewRetrospective({ state: 'finished' }))
      const second = await store.retrospectives.add(aNewRetrospective({ state: 'reviewing' }))

      expect(await store.retrospectives.listBySession(sessionId)).toEqual([first, second])
      expect(await store.retrospectives.findLatestBySession(sessionId)).toEqual(second)
    })

    /**
     * The dashboard's flat list crosses sessions (KC-0020), so `listAll` is the
     * one read here that does not take a session id — and it has to keep the
     * same oldest-first order `listBySession` promises, because that order is
     * what makes "Retro #n within its session" countable in one pass.
     */
    test('lists every session’s retrospectives together, oldest first', async () => {
      const otherSessionId = await seedSession(store, 'uuid-other')
      const first = await store.retrospectives.add(aNewRetrospective({ state: 'finished' }))
      const elsewhere = await store.retrospectives.add(
        aNewRetrospective({ sessionId: otherSessionId }),
      )
      const second = await store.retrospectives.add(aNewRetrospective({ state: 'reviewing' }))

      expect(await store.retrospectives.listAll()).toEqual([first, elsewhere, second])
    })

    test('lists nothing when no retrospective was ever started', async () => {
      expect(await (await makeStore()).retrospectives.listAll()).toEqual([])
    })

    test('finds only the non-finished retrospective of a session', async () => {
      await store.retrospectives.add(
        aNewRetrospective({ state: 'finished', finishedAt: '2026-08-23T10:00:00.000Z' }),
      )
      const open = await store.retrospectives.add(aNewRetrospective({ state: 'reviewing' }))

      expect(await store.retrospectives.findOpenBySession(sessionId)).toEqual(open)
    })

    test('moves through the state machine and stamps finishedAt only when finished', async () => {
      const retro = await store.retrospectives.add(aNewRetrospective())

      const reviewing = await store.retrospectives.setState(retro.id, 'reviewing')
      expect(reviewing?.state).toBe('reviewing')
      expect(reviewing?.finishedAt).toBeUndefined()

      const finished = await store.retrospectives.setState(
        retro.id,
        'finished',
        '2026-08-23T11:00:00.000Z',
      )
      expect(finished?.state).toBe('finished')
      expect(finished?.finishedAt).toBe('2026-08-23T11:00:00.000Z')
      expect(await store.retrospectives.findById(retro.id)).toEqual(finished)
    })

    test('returns undefined when asked to move a retrospective that is not there', async () => {
      expect(await store.retrospectives.setState(404, 'finished')).toBeUndefined()
    })
  })
}
