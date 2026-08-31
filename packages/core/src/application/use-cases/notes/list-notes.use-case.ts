import type { Store } from '#application/ports/store.port'
import { NotFoundError } from '#domain/errors/not-found.error'
import type { Actor } from '#domain/models/actor.model'
import type { Annotation } from '#domain/models/annotation.model'
import type { Note } from '#domain/models/note.model'
import { resolveSession, type SessionRef } from '#domain/services/reference.service'

export type NoteView = {
  readonly note: Note
  /** Present only when human data was asked for, and only on AI notes. */
  readonly annotation: Annotation | undefined
}

export type ListNotesInput = {
  readonly actor: Actor
  readonly session: SessionRef
  /** `note list --with-human`: human notes and annotations included. */
  readonly withHuman?: boolean
}

export type ListNotesOutput = { readonly notes: readonly NoteView[] }

/**
 * The session's notes, oldest first.
 *
 * The one-way glass (KC-0015) — the AI sees human notes and annotations **only at
 * drafting time** — is caller protocol, not a mechanical rule, and it is not
 * enforced here: this use case returns exactly what it is asked for, and the
 * drafting step is the caller that asks for human data. Making it mechanical
 * would mean the core deciding when the AI is "drafting", which it cannot know.
 * The actor invariants that *are* mechanical (who may write what) are enforced;
 * this one is a discipline the skill keeps.
 */
export class ListNotesUseCase {
  constructor(private readonly store: Store) {}

  async execute(input: ListNotesInput): Promise<ListNotesOutput> {
    const session = NotFoundError.require(
      await resolveSession(this.store.sessions, input.session),
      'session',
      input.session,
    )

    const withHuman = input.withHuman === true
    const notes = await this.store.notes.listBySession(
      session.id,
      withHuman ? {} : { author: 'ai' },
    )
    if (!withHuman) {
      return { notes: notes.map((note) => ({ note, annotation: undefined })) }
    }

    const annotations = await this.store.annotations.listBySession(session.id)
    const byNoteId = new Map(annotations.map((annotation) => [annotation.noteId, annotation]))
    return { notes: notes.map((note) => ({ note, annotation: byNoteId.get(note.id) })) }
  }
}
