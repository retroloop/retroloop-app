import { beforeEach, describe, expect, test } from 'bun:test'
import { ConflictError } from '#domain/errors/conflict.error'
import { NotFoundError } from '#domain/errors/not-found.error'
import { ValidationError } from '#domain/errors/validation.error'
import type { Session } from '#domain/models/session.model'
import { createHarness, type Harness } from '../support/harness'

describe('notes', () => {
  let harness: Harness
  let session: Session

  beforeEach(async () => {
    harness = createHarness()
    session = await harness.session()
  })

  describe('add (AI)', () => {
    test('appends a note and announces it', async () => {
      const { note } = await harness.app.notes.addAi.execute({
        actor: 'ai',
        session: session.id,
        text: 'The deploy waited on a stale lock again.',
        kind: 'ai-cost',
      })

      expect(note.author).toBe('ai')
      expect(note.kind).toBe('ai-cost')
      expect(note.at).toBe(harness.clock.iso())
      expect(await harness.eventNames()).toEqual(['SessionCreated', 'NoteAdded'])
    })

    test('defaults the kind to human-cost', async () => {
      const { note } = await harness.app.notes.addAi.execute({
        actor: 'ai',
        session: session.id,
        text: 'a friction',
      })

      expect(note.kind).toBe('human-cost')
    })

    test('rejects an empty note and an unknown session', async () => {
      await expect(
        harness.app.notes.addAi.execute({ actor: 'ai', session: session.id, text: '   ' }),
      ).rejects.toBeInstanceOf(ValidationError)
      await expect(
        harness.app.notes.addAi.execute({ actor: 'ai', session: 404, text: 'a friction' }),
      ).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  describe('add (human)', () => {
    test('appends the human’s own note, which carries no kind', async () => {
      const { note } = await harness.app.notes.addHuman.execute({
        actor: 'human',
        session: session.id,
        text: 'This cost me the whole afternoon.',
      })

      expect(note.author).toBe('human')
      expect(note.kind).toBeUndefined()
      expect(await harness.eventNames()).toEqual(['SessionCreated', 'NoteAdded'])
    })

    test('rejects an empty note and an unknown session', async () => {
      await expect(
        harness.app.notes.addHuman.execute({ actor: 'human', session: session.id, text: '' }),
      ).rejects.toBeInstanceOf(ValidationError)
      await expect(
        harness.app.notes.addHuman.execute({ actor: 'human', session: 404, text: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  describe('annotate', () => {
    test('records the human’s one-shot remark on an AI note', async () => {
      const { note } = await harness.app.notes.addAi.execute({
        actor: 'ai',
        session: session.id,
        text: 'a friction',
      })

      const { annotation } = await harness.app.notes.annotate.execute({
        actor: 'human',
        noteId: note.id,
        text: 'Worse than that — it happened twice.',
      })

      expect(annotation.noteId).toBe(note.id)
      expect(annotation.sessionId).toBe(session.id)
      expect(await harness.eventNames()).toEqual(['SessionCreated', 'NoteAdded', 'AnnotationAdded'])
    })

    test('refuses a second annotation — annotations are one-shot, not a thread', async () => {
      const { note } = await harness.app.notes.addAi.execute({
        actor: 'ai',
        session: session.id,
        text: 'a friction',
      })
      await harness.app.notes.annotate.execute({
        actor: 'human',
        noteId: note.id,
        text: 'first word',
      })

      await expect(
        harness.app.notes.annotate.execute({
          actor: 'human',
          noteId: note.id,
          text: 'second word',
        }),
      ).rejects.toBeInstanceOf(ConflictError)
    })

    test('refuses to annotate a human note, an unknown note, or with nothing to say', async () => {
      const { note } = await harness.app.notes.addHuman.execute({
        actor: 'human',
        session: session.id,
        text: 'my own note',
      })

      await expect(
        harness.app.notes.annotate.execute({ actor: 'human', noteId: note.id, text: 'x' }),
      ).rejects.toBeInstanceOf(ValidationError)
      await expect(
        harness.app.notes.annotate.execute({ actor: 'human', noteId: 404, text: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundError)
      await expect(
        harness.app.notes.annotate.execute({ actor: 'human', noteId: note.id, text: '' }),
      ).rejects.toBeInstanceOf(ValidationError)
    })
  })

  describe('list', () => {
    beforeEach(async () => {
      const { note } = await harness.app.notes.addAi.execute({
        actor: 'ai',
        session: session.id,
        text: 'an AI note',
      })
      await harness.app.notes.addHuman.execute({
        actor: 'human',
        session: session.id,
        text: 'a human note',
      })
      await harness.app.notes.annotate.execute({
        actor: 'human',
        noteId: note.id,
        text: 'an annotation',
      })
    })

    test('returns only AI notes by default — the one-way glass during the session', async () => {
      const { notes } = await harness.app.notes.list.execute({ actor: 'ai', session: session.id })

      expect(notes.map((view) => view.note.text)).toEqual(['an AI note'])
      expect(notes[0]?.annotation).toBeUndefined()
    })

    test('returns human notes and annotations when the drafting step asks for them', async () => {
      const { notes } = await harness.app.notes.list.execute({
        actor: 'ai',
        session: session.id,
        withHuman: true,
      })

      expect(notes.map((view) => view.note.text)).toEqual(['an AI note', 'a human note'])
      expect(notes[0]?.annotation?.text).toBe('an annotation')
      expect(notes[1]?.annotation).toBeUndefined()
    })

    test('is a NotFound for an unknown session', async () => {
      await expect(
        harness.app.notes.list.execute({ actor: 'ai', session: 404 }),
      ).rejects.toBeInstanceOf(NotFoundError)
    })
  })
})
