import type { Database } from 'bun:sqlite'
import type {
  NewRetrospective,
  Retrospective,
  RetrospectiveState,
} from '#domain/models/retrospective.model'
import type { RetrospectiveRepository } from '#domain/repositories/retrospective.repository'
import { checked, optionalText } from '#infrastructure/sqlite/rows'

type RetrospectiveRow = {
  id: number
  session_id: number
  state: string
  started_at: string
  finished_at: string | null
}

const COLUMNS = 'id, session_id, state, started_at, finished_at'

function toRetrospective(row: RetrospectiveRow): Retrospective {
  return {
    id: row.id,
    sessionId: row.session_id,
    state: checked<RetrospectiveState>(row.state),
    startedAt: row.started_at,
    finishedAt: optionalText(row.finished_at),
  }
}

export class SqliteRetrospectiveRepository implements RetrospectiveRepository {
  constructor(private readonly db: Database) {}

  async add(retrospective: NewRetrospective): Promise<Retrospective> {
    const { lastInsertRowid } = this.db.run(
      `INSERT INTO retrospectives (session_id, state, started_at, finished_at)
       VALUES (?, ?, ?, ?)`,
      [
        retrospective.sessionId,
        retrospective.state,
        retrospective.startedAt,
        retrospective.finishedAt ?? null,
      ],
    )
    const stored = await this.findById(Number(lastInsertRowid))
    if (stored === undefined) throw new Error('retrospective disappeared immediately after insert')
    return stored
  }

  async findById(id: number): Promise<Retrospective | undefined> {
    const row = this.db
      .query<RetrospectiveRow, [number]>(`SELECT ${COLUMNS} FROM retrospectives WHERE id = ?`)
      .get(id)
    return row === null ? undefined : toRetrospective(row)
  }

  async listBySession(sessionId: number): Promise<readonly Retrospective[]> {
    return this.db
      .query<RetrospectiveRow, [number]>(
        `SELECT ${COLUMNS} FROM retrospectives WHERE session_id = ? ORDER BY id ASC`,
      )
      .all(sessionId)
      .map(toRetrospective)
  }

  async listAll(): Promise<readonly Retrospective[]> {
    return this.db
      .query<RetrospectiveRow, []>(`SELECT ${COLUMNS} FROM retrospectives ORDER BY id ASC`)
      .all()
      .map(toRetrospective)
  }

  async findOpenBySession(sessionId: number): Promise<Retrospective | undefined> {
    const row = this.db
      .query<RetrospectiveRow, [number]>(
        `SELECT ${COLUMNS} FROM retrospectives
         WHERE session_id = ? AND state <> 'finished'
         ORDER BY id ASC LIMIT 1`,
      )
      .get(sessionId)
    return row === null ? undefined : toRetrospective(row)
  }

  async findLatestBySession(sessionId: number): Promise<Retrospective | undefined> {
    const row = this.db
      .query<RetrospectiveRow, [number]>(
        `SELECT ${COLUMNS} FROM retrospectives WHERE session_id = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(sessionId)
    return row === null ? undefined : toRetrospective(row)
  }

  /**
   * The state machine's only move (`open → reviewing → finished`), not an edit.
   * `finished_at` is stamped when — and only when — the state is `finished`, so a
   * retrospective can never carry a finish time it did not reach.
   */
  async setState(
    id: number,
    state: RetrospectiveState,
    finishedAt?: string,
  ): Promise<Retrospective | undefined> {
    const current = await this.findById(id)
    if (current === undefined) return undefined

    this.db.run('UPDATE retrospectives SET state = ?, finished_at = ? WHERE id = ?', [
      state,
      state === 'finished' ? (finishedAt ?? current.finishedAt ?? null) : null,
      id,
    ])
    return this.findById(id)
  }
}
