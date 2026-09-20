import type { Actor } from '#domain/models/actor.model'
import type { NewNote, Note } from '#domain/models/note.model'

export type NoteListFilter = {
  /**
   * Restricts to one author. The *drafting-time* rule — the AI reads human notes
   * only when drafting — is caller protocol, not enforced here: this
   * repository just returns what it is asked for.
   */
  readonly author?: Actor
}

/** Append-only for both actors: no update, no delete. */
export type NoteRepository = {
  add(note: NewNote): Promise<Note>
  findById(id: number): Promise<Note | undefined>
  /** Oldest first — notes are read as a timeline. */
  listBySession(sessionId: number, filter?: NoteListFilter): Promise<readonly Note[]>
}
