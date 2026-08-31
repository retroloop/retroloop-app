import { type Clock, timestamp } from '#application/ports/clock.port'
import type { Store } from '#application/ports/store.port'
import { parseOrThrow } from '#application/schemas/parse'
import { nonEmptyTextSchema } from '#application/schemas/text.schema'
import { ConflictError } from '#domain/errors/conflict.error'
import { ForbiddenActorError } from '#domain/errors/forbidden-actor.error'
import { NotFoundError } from '#domain/errors/not-found.error'
import { ValidationError } from '#domain/errors/validation.error'
import { newDomainEvent } from '#domain/events/domain-event.model'
import type { Actor } from '#domain/models/actor.model'
import type { Annotation } from '#domain/models/annotation.model'

export type AnnotateNoteInput = {
  readonly actor: Actor
  readonly noteId: number
  readonly text: string
}

export type AnnotateNoteOutput = { readonly annotation: Annotation }

/**
 * The human's one-shot remark on one AI note (KC-0015). Deliberately not a thread
 * — "we don't want him back-and-forth communication there" — so a second
 * annotation on the same note is a `ConflictError`, not a second row.
 *
 * Annotating a *human* note is a `ValidationError`: the target is wrong, not the
 * state. Annotations exist to steer the agent, and the agent does not write the
 * notes the human already owns.
 */
export class AnnotateNoteUseCase {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}

  async execute(input: AnnotateNoteInput): Promise<AnnotateNoteOutput> {
    ForbiddenActorError.assert('human', input.actor, 'annotating a note')
    const text = parseOrThrow(nonEmptyTextSchema, input.text, 'annotation.text')

    return this.store.tx(async (repositories) => {
      const note = NotFoundError.require(
        await repositories.notes.findById(input.noteId),
        'note',
        input.noteId,
      )
      if (note.author !== 'ai') {
        throw ValidationError.single('noteId', 'only an AI note can be annotated')
      }
      if ((await repositories.annotations.findByNoteId(note.id)) !== undefined) {
        throw new ConflictError(`note ${note.id} is already annotated — annotations are one-shot`)
      }

      const at = timestamp(this.clock)
      const annotation = await repositories.annotations.add({
        noteId: note.id,
        sessionId: note.sessionId,
        text,
        at,
      })
      await repositories.events.append(
        newDomainEvent(
          'AnnotationAdded',
          at,
          { sessionId: note.sessionId },
          { noteId: note.id, annotationId: annotation.id },
        ),
      )
      return { annotation }
    })
  }
}
