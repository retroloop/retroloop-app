import type { Store } from '#application/ports/store.port'
import { NotFoundError } from '#domain/errors/not-found.error'
import type { DomainEvent, EventName } from '#domain/events/domain-event.model'
import type { Actor } from '#domain/models/actor.model'
import {
  describeRetroRef,
  type RetroRef,
  resolveRetrospective,
} from '#domain/services/reference.service'

export type ListEventsInput = {
  readonly actor: Actor
  /** Exclusive cursor: the tailer's position, or a browser's `Last-Event-ID`. */
  readonly afterId?: number
  readonly retro?: RetroRef
  readonly names?: readonly EventName[]
  readonly limit?: number
}

export type ListEventsOutput = {
  readonly events: readonly DomainEvent[]
  /** The outbox's head — where a consumer should resume from next time. */
  readonly latestId: number
}

/**
 * The read side of the outbox (KC-0005). One query surface serves both consumers:
 * the server's tailer polls it from a persisted cursor and fans out over SSE, and
 * `review wait` polls it directly from its own process, filtered to
 * `ReviewFinished` for one retrospective (`REVIEW_WAIT_EVENT_NAMES`).
 *
 * `latestId` comes back with every page so a consumer that filters by name still
 * advances its cursor past events it did not ask for.
 */
export class ListEventsUseCase {
  constructor(private readonly store: Store) {}

  async execute(input: ListEventsInput): Promise<ListEventsOutput> {
    const retroId =
      input.retro === undefined
        ? undefined
        : NotFoundError.require(
            await resolveRetrospective(this.store, input.retro),
            'retrospective',
            describeRetroRef(input.retro),
          ).id

    return {
      events: await this.store.events.list({
        afterId: input.afterId,
        retroId,
        names: input.names,
        limit: input.limit,
      }),
      latestId: await this.store.events.latestId(),
    }
  }
}
