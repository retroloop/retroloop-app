import type {
  NewRetrospective,
  Retrospective,
  RetrospectiveState,
} from '#domain/models/retrospective.model'
import type { RetrospectiveRepository } from '#domain/repositories/retrospective.repository'
import { clone, type MemoryDatabase } from '#infrastructure/memory/memory-database'

export class MemoryRetrospectiveRepository implements RetrospectiveRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async add(retrospective: NewRetrospective): Promise<Retrospective> {
    const row: Retrospective = { id: this.db.nextId(), ...retrospective }
    this.db.tables.retrospectives.push(row)
    return clone(row)
  }

  async findById(id: number): Promise<Retrospective | undefined> {
    return clone(this.db.tables.retrospectives.find((retro) => retro.id === id))
  }

  async listBySession(sessionId: number): Promise<readonly Retrospective[]> {
    return clone(
      this.db.tables.retrospectives
        .filter((retro) => retro.sessionId === sessionId)
        .sort((left, right) => left.id - right.id),
    )
  }

  async listAll(): Promise<readonly Retrospective[]> {
    return clone([...this.db.tables.retrospectives].sort((left, right) => left.id - right.id))
  }

  async findOpenBySession(sessionId: number): Promise<Retrospective | undefined> {
    return clone(
      this.db.tables.retrospectives.find(
        (retro) => retro.sessionId === sessionId && retro.state !== 'finished',
      ),
    )
  }

  async findLatestBySession(sessionId: number): Promise<Retrospective | undefined> {
    return clone(
      this.db.tables.retrospectives
        .filter((retro) => retro.sessionId === sessionId)
        .sort((left, right) => right.id - left.id)
        .at(0),
    )
  }

  async setState(
    id: number,
    state: RetrospectiveState,
    finishedAt?: string,
  ): Promise<Retrospective | undefined> {
    const index = this.db.tables.retrospectives.findIndex((retro) => retro.id === id)
    const current = this.db.tables.retrospectives[index]
    if (current === undefined) return undefined

    const updated: Retrospective = {
      ...current,
      state,
      finishedAt: state === 'finished' ? (finishedAt ?? current.finishedAt) : undefined,
    }
    this.db.tables.retrospectives[index] = updated
    return clone(updated)
  }
}
