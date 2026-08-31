import { type Clock, timestamp } from '#application/ports/clock.port'
import type { Store } from '#application/ports/store.port'
import { parseOrThrow } from '#application/schemas/parse'
import { nonEmptyTextSchema } from '#application/schemas/text.schema'
import { ForbiddenActorError } from '#domain/errors/forbidden-actor.error'
import { NotFoundError } from '#domain/errors/not-found.error'
import { newDomainEvent } from '#domain/events/domain-event.model'
import type { Actor } from '#domain/models/actor.model'
import type { Note } from '#domain/models/note.model'
import { resolveSession, type SessionRef } from '#domain/services/reference.service'

export type AddHumanNoteInput = {
  readonly actor: Actor
  readonly session: SessionRef
  readonly text: string
}

export type AddHumanNoteOutput = { readonly note: Note }

/**
 * The human's own note on a session — UI-only, append-only, and mechanically
 * closed to the AI (data-model.md §Mutability matrix). Human notes carry no
 * `kind`; the AI's cost/impact classification is not the human's to file.
 */
export class AddHumanNoteUseCase {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}

  async execute(input: AddHumanNoteInput): Promise<AddHumanNoteOutput> {
    ForbiddenActorError.assert('human', input.actor, 'writing a human note')
    const text = parseOrThrow(nonEmptyTextSchema, input.text, 'note.text')

    return this.store.tx(async (repositories) => {
      const session = NotFoundError.require(
        await resolveSession(repositories.sessions, input.session),
        'session',
        input.session,
      )
      const at = timestamp(this.clock)
      const note = await repositories.notes.add({
        sessionId: session.id,
        author: 'human',
        kind: undefined,
        text,
        at,
      })
      await repositories.events.append(
        newDomainEvent(
          'NoteAdded',
          at,
          { sessionId: session.id },
          { noteId: note.id, author: 'human' },
        ),
      )
      return { note }
    })
  }
}
