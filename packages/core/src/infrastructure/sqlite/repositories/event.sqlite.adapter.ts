import type { Database } from 'bun:sqlite'
import type {
  DomainEvent,
  EventData,
  EventName,
  NewDomainEvent,
} from '#domain/events/domain-event.model'
import type { EventListFilter, EventRepository } from '#domain/repositories/event.repository'
import { checked, optionalNumber, optionalText, parseJson } from '#infrastructure/sqlite/rows'

type EventRow = {
  id: number
  name: string
  at: string
  session_id: number | null
  retro_id: number | null
  revision_n: number | null
  rid: string | null
  data: string
}

const COLUMNS = 'id, name, at, session_id, retro_id, revision_n, rid, data'

function toEvent(row: EventRow): DomainEvent {
  return {
    id: row.id,
    name: checked<EventName>(row.name),
    at: row.at,
    sessionId: optionalNumber(row.session_id),
    retroId: optionalNumber(row.retro_id),
    revisionN: optionalNumber(row.revision_n),
    rid: optionalText(row.rid),
    data: parseJson<EventData>(row.data),
  }
}

/**
 * The outbox, append-only by construction: `append` and two reads. An event that
 * has been observed can never be rewritten, which is what makes replay honest.
 */
export class SqliteEventRepository implements EventRepository {
  constructor(private readonly db: Database) {}

  async append(event: NewDomainEvent): Promise<DomainEvent> {
    const { lastInsertRowid } = this.db.run(
      `INSERT INTO events (name, at, session_id, retro_id, revision_n, rid, data)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        event.name,
        event.at,
        event.sessionId ?? null,
        event.retroId ?? null,
        event.revisionN ?? null,
        event.rid ?? null,
        JSON.stringify(event.data),
      ],
    )
    const row = this.db
      .query<EventRow, [number]>(`SELECT ${COLUMNS} FROM events WHERE id = ?`)
      .get(Number(lastInsertRowid))
    if (row === null) throw new Error('event disappeared immediately after insert')
    return toEvent(row)
  }

  async list(filter: EventListFilter = {}): Promise<readonly DomainEvent[]> {
    // An explicitly empty name filter asks for nothing, and `IN ()` is not SQL.
    if (filter.names !== undefined && filter.names.length === 0) return []

    const conditions: string[] = []
    const parameters: (string | number)[] = []

    if (filter.afterId !== undefined) {
      conditions.push('id > ?')
      parameters.push(filter.afterId)
    }
    if (filter.retroId !== undefined) {
      conditions.push('retro_id = ?')
      parameters.push(filter.retroId)
    }
    if (filter.sessionId !== undefined) {
      conditions.push('session_id = ?')
      parameters.push(filter.sessionId)
    }
    if (filter.names !== undefined) {
      conditions.push(`name IN (${filter.names.map(() => '?').join(', ')})`)
      parameters.push(...filter.names)
    }
    parameters.push(filter.limit ?? -1)

    const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`
    return this.db
      .query<EventRow, (string | number)[]>(
        `SELECT ${COLUMNS} FROM events ${where} ORDER BY id ASC LIMIT ?`,
      )
      .all(...parameters)
      .map(toEvent)
  }

  async latestId(): Promise<number> {
    return (
      this.db.query<{ id: number | null }, []>('SELECT MAX(id) AS id FROM events').get()?.id ?? 0
    )
  }
}
