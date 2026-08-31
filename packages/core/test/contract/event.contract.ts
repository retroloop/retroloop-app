import { beforeEach, describe, expect, test } from 'bun:test'
import type { Store } from '#application/ports/store.port'
import type { NewDomainEvent } from '#domain/events/domain-event.model'
import type { StoreFactory } from './store.contract'

function anEvent(overrides: Partial<NewDomainEvent> = {}): NewDomainEvent {
  return {
    name: 'NoteAdded',
    at: '2026-08-23T09:10:00.000Z',
    sessionId: 1,
    retroId: undefined,
    revisionN: undefined,
    rid: undefined,
    data: {},
    ...overrides,
  }
}

export function describeEventRepositoryContract(label: string, makeStore: StoreFactory): void {
  describe(`${label} · EventRepository`, () => {
    let store: Store

    beforeEach(async () => {
      store = await makeStore()
    })

    test('starts empty', async () => {
      expect(await store.events.list()).toEqual([])
      expect(await store.events.latestId()).toBe(0)
    })

    test('appends with increasing ids — the cursor every consumer replays from', async () => {
      const first = await store.events.append(anEvent())
      const second = await store.events.append(anEvent({ name: 'AnnotationAdded' }))

      expect(second.id).toBeGreaterThan(first.id)
      expect(await store.events.latestId()).toBe(second.id)
      expect(await store.events.list()).toEqual([first, second])
    })

    test('keeps the payload it was given', async () => {
      const event = await store.events.append(
        anEvent({ retroId: 7, revisionN: 2, rid: 'r-one', data: { records: 3, url: '/retros/7' } }),
      )

      expect(await store.events.list()).toEqual([event])
      expect(event.data).toEqual({ records: 3, url: '/retros/7' })
    })

    test('replays everything after a cursor', async () => {
      const first = await store.events.append(anEvent())
      const second = await store.events.append(anEvent({ name: 'RevisionCreated' }))
      const third = await store.events.append(anEvent({ name: 'ReviewFinished' }))

      expect(await store.events.list({ afterId: first.id })).toEqual([second, third])
      expect(await store.events.list({ afterId: third.id })).toEqual([])
    })

    test('filters by retrospective, session, name and limit', async () => {
      await store.events.append(anEvent({ sessionId: 1, retroId: 1, name: 'RevisionCreated' }))
      const finished = await store.events.append(
        anEvent({ sessionId: 1, retroId: 1, name: 'ReviewFinished' }),
      )
      await store.events.append(anEvent({ sessionId: 2, retroId: 2, name: 'ReviewFinished' }))

      expect(await store.events.list({ retroId: 1, names: ['ReviewFinished'] })).toEqual([finished])
      expect(await store.events.list({ sessionId: 2 })).toHaveLength(1)
      expect(await store.events.list({ retroId: 1, limit: 1 })).toHaveLength(1)
      expect(await store.events.list({ names: ['ChangesRequested'] })).toEqual([])
    })
  })
}
