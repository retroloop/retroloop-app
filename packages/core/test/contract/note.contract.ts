import { beforeEach, describe, expect, test } from 'bun:test'
import type { Store } from '#application/ports/store.port'
import type { NewNote } from '#domain/models/note.model'
import { type StoreFactory, seedSession } from './store.contract'

export function describeNoteRepositoryContract(label: string, makeStore: StoreFactory): void {
  describe(`${label} · NoteRepository`, () => {
    let store: Store
    let sessionId: number
    let otherSessionId: number

    const aNewNote = (overrides: Partial<NewNote> = {}): NewNote => ({
      sessionId,
      author: 'ai',
      kind: 'human-cost',
      text: 'The deploy waited on a stale lock again.',
      at: '2026-08-23T09:10:00.000Z',
      ...overrides,
    })

    beforeEach(async () => {
      store = await makeStore()
      sessionId = await seedSession(store, 'uuid-first')
      otherSessionId = await seedSession(store, 'uuid-second')
    })

    test('stores an AI note with its kind', async () => {
      const note = await store.notes.add(aNewNote({ kind: 'ai-cost' }))

      expect(await store.notes.findById(note.id)).toEqual(note)
      expect(note.kind).toBe('ai-cost')
    })

    test('stores a human note, which has no kind', async () => {
      const note = await store.notes.add(aNewNote({ author: 'human', kind: undefined }))

      expect((await store.notes.findById(note.id))?.kind).toBeUndefined()
    })

    test('returns undefined for a miss', async () => {
      expect(await store.notes.findById(404)).toBeUndefined()
      expect(await store.notes.listBySession(404)).toEqual([])
    })

    test('lists a session oldest first — notes are read as a timeline', async () => {
      const first = await store.notes.add(aNewNote({ text: 'first' }))
      const second = await store.notes.add(aNewNote({ text: 'second' }))
      await store.notes.add(aNewNote({ sessionId: otherSessionId, text: 'other session' }))

      expect(await store.notes.listBySession(sessionId)).toEqual([first, second])
    })

    test('filters by author — what "with human notes or without" is built on', async () => {
      const ai = await store.notes.add(aNewNote())
      const human = await store.notes.add(aNewNote({ author: 'human', kind: undefined }))

      expect(await store.notes.listBySession(sessionId, { author: 'ai' })).toEqual([ai])
      expect(await store.notes.listBySession(sessionId, { author: 'human' })).toEqual([human])
      expect(await store.notes.listBySession(sessionId)).toEqual([ai, human])
    })
  })
}
