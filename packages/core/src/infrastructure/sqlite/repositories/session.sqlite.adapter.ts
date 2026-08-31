import type { Database } from 'bun:sqlite'
import type { NewSession, Session } from '#domain/models/session.model'
import type { SessionListFilter, SessionRepository } from '#domain/repositories/session.repository'
import { fromBit, optionalText, toBit } from '#infrastructure/sqlite/rows'

type SessionRow = {
  id: number
  claude_session: string
  project: string | null
  cwd: string
  branch: string | null
  supervised: number
  started_at: string
}

const COLUMNS = 'id, claude_session, project, cwd, branch, supervised, started_at'

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    claudeSession: row.claude_session,
    project: optionalText(row.project),
    cwd: row.cwd,
    branch: optionalText(row.branch),
    supervised: fromBit(row.supervised),
    startedAt: row.started_at,
  }
}

export class SqliteSessionRepository implements SessionRepository {
  constructor(private readonly db: Database) {}

  /**
   * Every write reads its row back rather than assuming what it wrote.
   * It costs one indexed lookup and buys the guarantee that `add()` returns
   * exactly what a later `findById()` will — the same guarantee the contract
   * suite asserts of both adapters.
   */
  async add(session: NewSession): Promise<Session> {
    const { lastInsertRowid } = this.db.run(
      `INSERT INTO sessions (claude_session, project, cwd, branch, supervised, started_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        session.claudeSession,
        session.project ?? null,
        session.cwd,
        session.branch ?? null,
        toBit(session.supervised),
        session.startedAt,
      ],
    )
    const stored = await this.findById(Number(lastInsertRowid))
    if (stored === undefined) throw new Error('session disappeared immediately after insert')
    return stored
  }

  async findById(id: number): Promise<Session | undefined> {
    const row = this.db
      .query<SessionRow, [number]>(`SELECT ${COLUMNS} FROM sessions WHERE id = ?`)
      .get(id)
    return row === null ? undefined : toSession(row)
  }

  async findByClaudeSession(claudeSession: string): Promise<Session | undefined> {
    const row = this.db
      .query<SessionRow, [string]>(`SELECT ${COLUMNS} FROM sessions WHERE claude_session = ?`)
      .get(claudeSession)
    return row === null ? undefined : toSession(row)
  }

  async list(filter: SessionListFilter = {}): Promise<readonly Session[]> {
    // `LIMIT -1` is SQLite's "no limit", which keeps this one statement.
    return this.db
      .query<SessionRow, [string | null, string | null, number]>(
        `SELECT ${COLUMNS} FROM sessions
         WHERE (? IS NULL OR project = ?)
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(filter.project ?? null, filter.project ?? null, filter.limit ?? -1)
      .map(toSession)
  }
}
