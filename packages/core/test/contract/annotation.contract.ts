import { beforeEach, describe, expect, test } from 'bun:test'
import type { Store } from '#application/ports/store.port'
import type { NewAnnotation } from '#domain/models/annotation.model'
import { type StoreFactory, seedNote, seedSession } from './store.contract'

export function describeAnnotationRepositoryContract(label: string, makeStore: StoreFactory): void {
  describe(`${label} · AnnotationRepository`, () => {
    let store: Store
    let sessionId: number
    let otherSessionId: number
    let noteIds: number[]
    let otherNoteId: number

    const aNewAnnotation = (overrides: Partial<NewAnnotation> = {}): NewAnnotation => ({
      noteId: noteIds[0] ?? 0,
      sessionId,
      text: 'This one cost me the whole afternoon.',
      at: '2026-08-23T09:20:00.000Z',
      ...overrides,
    })

    beforeEach(async () => {
      store = await makeStore()
      sessionId = await seedSession(store, 'uuid-first')
      otherSessionId = await seedSession(store, 'uuid-second')
      noteIds = [
        await seedNote(store, sessionId, 'first'),
        await seedNote(store, sessionId, 'second'),
      ]
      otherNoteId = await seedNote(store, otherSessionId, 'elsewhere')
    })

    test('stores an annotation and finds it by the note it belongs to', async () => {
      const annotation = await store.annotations.add(aNewAnnotation())

      expect(await store.annotations.findByNoteId(noteIds[0] ?? 0)).toEqual(annotation)
    })

    test('returns undefined for an unannotated note', async () => {
      expect(await store.annotations.findByNoteId(404)).toBeUndefined()
      expect(await store.annotations.findByNoteId(noteIds[1] ?? 0)).toBeUndefined()
    })

    test('lists a session oldest first', async () => {
      const first = await store.annotations.add(aNewAnnotation({ noteId: noteIds[0] }))
      const second = await store.annotations.add(aNewAnnotation({ noteId: noteIds[1] }))
      await store.annotations.add(
        aNewAnnotation({ noteId: otherNoteId, sessionId: otherSessionId }),
      )

      expect(await store.annotations.listBySession(sessionId)).toEqual([first, second])
      expect(await store.annotations.listBySession(404)).toEqual([])
    })
  })
}
