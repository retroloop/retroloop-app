import { type Clock, timestamp } from '#application/ports/clock.port'
import type { Store } from '#application/ports/store.port'
import { noteKindSchema } from '#application/schemas/enums.schema'
import { parseOrThrow } from '#application/schemas/parse'
import { nonEmptyTextSchema } from '#application/schemas/text.schema'
import { ForbiddenActorError } from '#domain/errors/forbidden-actor.error'
import { NotFoundError } from '#domain/errors/not-found.error'
import { newDomainEvent } from '#domain/events/domain-event.model'
import type { Actor } from '#domain/models/actor.model'
import type { Note, NoteKind } from '#domain/models/note.model'
import { resolveSession, type SessionRef } from '#domain/services/reference.service'

export type AddAiNoteInput = {
  readonly actor: Actor
  readonly session: SessionRef
  readonly text: string
  /** Defaults to `human-cost`, as `retro note add` does (cli.md). */
  readonly kind?: NoteKind
}

export type AddAiNoteOutput = { readonly note: Note }

/**
 * The AI's friction note, filed as it happens. Append-only: there is no
 * use case that edits or removes one, here or anywhere.
 */
export class AddAiNoteUseCase {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}

  async execute(input: AddAiNoteInput): Promise<AddAiNoteOutput> {
    ForbiddenActorError.assert('ai', input.actor, 'filing an AI note')
    const text = parseOrThrow(nonEmptyTextSchema, input.text, 'note.text')
    const kind = parseOrThrow(noteKindSchema, input.kind ?? 'human-cost', 'note.kind')

    return this.store.tx(async (repositories) => {
      const session = NotFoundError.require(
        await resolveSession(repositories.sessions, input.session),
        'session',
        input.session,
      )
      const at = timestamp(this.clock)
      const note = await repositories.notes.add({
        sessionId: session.id,
        author: 'ai',
        kind,
        text,
        at,
      })
      await repositories.events.append(
        newDomainEvent(
          'NoteAdded',
          at,
          { sessionId: session.id },
          { noteId: note.id, author: 'ai', kind },
        ),
      )
      return { note }
    })
  }
}
