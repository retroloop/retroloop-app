import type { Actor } from '#domain/models/actor.model'

/** Seeds the record's `impacts` default; AI notes only (cli.md `note --kind`). */
export type NoteKind = 'human-cost' | 'ai-cost'

/**
 * A friction note. Notes belong to the session, not to a retrospective;
 * a retrospective drafts from the notes written since the previous one finished.
 *
 * Append-only for both authors. `kind` is set on AI notes and absent on human
 * notes, which have no kind in the model.
 */
export type Note = {
  readonly id: number
  readonly sessionId: number
  readonly author: Actor
  readonly kind: NoteKind | undefined
  readonly text: string
  readonly at: string
}

export type NewNote = Omit<Note, 'id'>
