import type { DomainEvent, EventName, NewDomainEvent } from '#domain/events/domain-event.model'

export type EventListFilter = {
  /** Exclusive cursor: the tailer's persisted position, the browser's `Last-Event-ID`. */
  readonly afterId?: number
  readonly retroId?: number
  readonly sessionId?: number
  readonly names?: readonly EventName[]
  readonly limit?: number
}

/**
 * The outbox. Append-only by construction — an event that has been observed can
 * never be rewritten, which is what makes replay honest.
 */
export type EventRepository = {
  append(event: NewDomainEvent): Promise<DomainEvent>
  /** Ascending by id — the order consumers replay in. */
  list(filter?: EventListFilter): Promise<readonly DomainEvent[]>
  /** 0 when the outbox is empty. */
  latestId(): Promise<number>
}
