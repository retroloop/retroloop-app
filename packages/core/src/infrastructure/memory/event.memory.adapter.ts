import type { DomainEvent, NewDomainEvent } from '#domain/events/domain-event.model'
import type { EventListFilter, EventRepository } from '#domain/repositories/event.repository'
import { clone, type MemoryDatabase } from '#infrastructure/memory/memory-database'

export class MemoryEventRepository implements EventRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async append(event: NewDomainEvent): Promise<DomainEvent> {
    const row: DomainEvent = { id: this.db.nextId(), ...event }
    this.db.tables.events.push(row)
    return clone(row)
  }

  async list(filter: EventListFilter = {}): Promise<readonly DomainEvent[]> {
    const matching = this.db.tables.events
      .filter(
        (event) =>
          (filter.afterId === undefined || event.id > filter.afterId) &&
          (filter.retroId === undefined || event.retroId === filter.retroId) &&
          (filter.sessionId === undefined || event.sessionId === filter.sessionId) &&
          (filter.names === undefined || filter.names.includes(event.name)),
      )
      .sort((left, right) => left.id - right.id)
    return clone(filter.limit === undefined ? matching : matching.slice(0, filter.limit))
  }

  async latestId(): Promise<number> {
    return this.db.tables.events.reduce((highest, event) => Math.max(highest, event.id), 0)
  }
}
