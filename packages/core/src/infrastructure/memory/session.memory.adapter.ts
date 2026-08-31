import type { NewSession, Session } from '#domain/models/session.model'
import type { SessionListFilter, SessionRepository } from '#domain/repositories/session.repository'
import { clone, type MemoryDatabase } from '#infrastructure/memory/memory-database'

export class MemorySessionRepository implements SessionRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async add(session: NewSession): Promise<Session> {
    const row: Session = { id: this.db.nextId(), ...session }
    this.db.tables.sessions.push(row)
    return clone(row)
  }

  async findById(id: number): Promise<Session | undefined> {
    return clone(this.db.tables.sessions.find((session) => session.id === id))
  }

  async findByClaudeSession(claudeSession: string): Promise<Session | undefined> {
    return clone(this.db.tables.sessions.find((session) => session.claudeSession === claudeSession))
  }

  async list(filter: SessionListFilter = {}): Promise<readonly Session[]> {
    const matching = this.db.tables.sessions
      .filter((session) => filter.project === undefined || session.project === filter.project)
      .sort((left, right) => right.id - left.id)
    return clone(filter.limit === undefined ? matching : matching.slice(0, filter.limit))
  }
}
