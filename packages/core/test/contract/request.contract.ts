import { beforeEach, describe, expect, test } from 'bun:test'
import type { Store } from '#application/ports/store.port'
import type { NewRequest, NewRequestResponse } from '#domain/models/request.model'
import { type StoreFactory, seedRetrospective, seedSession } from './store.contract'

function aNewResponse(overrides: Partial<NewRequestResponse> = {}): NewRequestResponse {
  return {
    requestId: 0,
    text: 'Added as r-stale-lock in revision 2.',
    revisionN: 2,
    at: '2026-08-23T10:30:00.000Z',
    ...overrides,
  }
}

export function describeRequestRepositoryContract(label: string, makeStore: StoreFactory): void {
  describe(`${label} · RequestRepository`, () => {
    let store: Store
    let retroId: number
    let otherRetroId: number

    const aNewRequest = (overrides: Partial<NewRequest> = {}): NewRequest => ({
      retroId,
      text: 'Add a record about the lock file',
      state: 'open',
      openedAt: '2026-08-23T10:00:00.000Z',
      closedAt: undefined,
      ...overrides,
    })

    beforeEach(async () => {
      store = await makeStore()
      const sessionId = await seedSession(store)
      retroId = await seedRetrospective(store, sessionId)
      otherRetroId = await seedRetrospective(store, sessionId)
    })

    test('opens a request with no responses', async () => {
      const request = await store.requests.add(aNewRequest())

      expect(request.state).toBe('open')
      expect(request.responses).toEqual([])
      expect(await store.requests.findById(request.id)).toEqual(request)
    })

    test('appends responses, keeping the revision that addressed the ask', async () => {
      const request = await store.requests.add(aNewRequest())

      await store.requests.addResponse(request.id, aNewResponse({ text: 'looking at it' }))
      const updated = await store.requests.addResponse(request.id, aNewResponse())

      expect(updated?.responses).toHaveLength(2)
      expect(updated?.responses[1]?.revisionN).toBe(2)
      expect(updated?.responses.every((response) => response.requestId === request.id)).toBe(true)
    })

    test('keeps an uncited response uncited', async () => {
      const request = await store.requests.add(aNewRequest())

      const updated = await store.requests.addResponse(
        request.id,
        aNewResponse({ revisionN: undefined }),
      )

      expect(updated?.responses[0]?.revisionN).toBeUndefined()
    })

    test('closing is a state change, not a deletion — the responses stay', async () => {
      const request = await store.requests.add(aNewRequest())
      await store.requests.addResponse(request.id, aNewResponse())

      const closed = await store.requests.close(request.id, '2026-08-23T11:00:00.000Z')

      expect(closed?.state).toBe('closed')
      expect(closed?.closedAt).toBe('2026-08-23T11:00:00.000Z')
      expect(closed?.responses).toHaveLength(1)
      expect(await store.requests.findById(request.id)).toEqual(closed)
    })

    test('returns undefined for a miss', async () => {
      expect(await store.requests.findById(404)).toBeUndefined()
      expect(await store.requests.addResponse(404, aNewResponse())).toBeUndefined()
      expect(await store.requests.close(404, '2026-08-23T11:00:00.000Z')).toBeUndefined()
    })

    test('lists a retrospective oldest first, optionally only the open ones', async () => {
      const open = await store.requests.add(aNewRequest({ text: 'still open' }))
      const closing = await store.requests.add(aNewRequest({ text: 'will close' }))
      await store.requests.close(closing.id, '2026-08-23T11:00:00.000Z')
      await store.requests.add(aNewRequest({ retroId: otherRetroId }))

      expect((await store.requests.listByRetro(retroId)).map((request) => request.text)).toEqual([
        'still open',
        'will close',
      ])
      expect(await store.requests.listByRetro(retroId, { openOnly: true })).toEqual([open])
      expect(await store.requests.listByRetro(404)).toEqual([])
    })
  })
}
