import { type Clock, timestamp } from '#application/ports/clock.port'
import type { Store } from '#application/ports/store.port'
import { loadThreadViews, type ThreadView } from '#application/views/thread.view'
import { ForbiddenActorError } from '#domain/errors/forbidden-actor.error'
import { NotFoundError } from '#domain/errors/not-found.error'
import { newDomainEvent } from '#domain/events/domain-event.model'
import type { Actor } from '#domain/models/actor.model'
import { refuseWhenFinished } from '#domain/services/finish-lock.service'

export type ResolveThreadInput = {
  /** Human only. The AI may answer a thread; it may not declare one dealt with. */
  readonly actor: Actor
  readonly threadId: number
  /** `true` marks it resolved, `false` reopens it. */
  readonly resolved: boolean
}

export type ResolveThreadOutput = { readonly thread: ThreadView }

/**
 * The human marks a thread dealt with, or reopens it (`r-resolvable-comments`).
 *
 * The user, and only the user, may mark a comment resolved — never the AI. So
 * the actor guard is the first statement in the method, below every adapter, and
 * the table's append-only triggers back it up at L1 — an AI that reached the
 * store directly still could not rewrite a row.
 *
 * Append-only, like every human field: reopening writes another version and
 * touches nothing, so "resolved at 14:02, reopened at 14:40" stays readable
 * forever. Marking a thread that already stands the same way is still a row,
 * because the human doing it again is a thing that happened.
 *
 * A finished retrospective refuses, on the doctrine `refuseWhenFinished` states:
 * an export is taken from it, and a document whose threads could still change
 * state behind the reader is a document nobody can cite.
 */
export class ResolveThreadUseCase {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}

  async execute(input: ResolveThreadInput): Promise<ResolveThreadOutput> {
    ForbiddenActorError.assert('human', input.actor, 'resolving a thread')

    return this.store.tx(async (repositories) => {
      const thread = NotFoundError.require(
        await repositories.threads.findById(input.threadId),
        'thread',
        input.threadId,
      )
      const retrospective = NotFoundError.require(
        await repositories.retrospectives.findById(thread.retroId),
        'retrospective',
        thread.retroId,
      )
      refuseWhenFinished(retrospective, 'its threads are settled')

      const previous = await repositories.threadResolutions.findLatest(thread.id)
      const at = timestamp(this.clock)
      const resolution = await repositories.threadResolutions.add({
        threadId: thread.id,
        version: (previous?.version ?? 0) + 1,
        resolved: input.resolved,
        at,
      })

      await repositories.events.append(
        newDomainEvent(
          input.resolved ? 'ThreadResolved' : 'ThreadReopened',
          at,
          { retroId: retrospective.id, rid: thread.rid },
          { threadId: thread.id, version: resolution.version },
        ),
      )

      const [view] = await loadThreadViews(repositories, retrospective.id, [thread])
      return { thread: NotFoundError.require(view, 'thread', thread.id) }
    })
  }
}
