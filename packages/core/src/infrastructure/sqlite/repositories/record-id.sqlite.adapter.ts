import type { Database } from 'bun:sqlite'
import type { NewRecordId, RecordId } from '#domain/models/record-id.model'
import type { RecordIdRepository } from '#domain/repositories/record-id.repository'

type RecordIdRow = {
  id: number
  retro_id: number
  rid: string
}

const COLUMNS = 'id, retro_id, rid'

function toRecordId(row: RecordIdRow): RecordId {
  return { id: row.id, retroId: row.retro_id, rid: row.rid }
}

/**
 * The global sequence, as SQLite keeps it: `AUTOINCREMENT` hands out the number
 * and this adapter never chooses one. That is the whole design — a number
 * computed in application code would be a number two writers can compute at the
 * same time, and the one guarantee this table exists to make is that a record's
 * number is its own.
 */
export class SqliteRecordIdRepository implements RecordIdRepository {
  constructor(private readonly db: Database) {}

  async add(entry: NewRecordId): Promise<RecordId> {
    const { lastInsertRowid } = this.db.run(
      'INSERT INTO record_ids (retro_id, rid) VALUES (?, ?)',
      [entry.retroId, entry.rid],
    )
    const row = this.db
      .query<RecordIdRow, [number]>(`SELECT ${COLUMNS} FROM record_ids WHERE id = ?`)
      .get(Number(lastInsertRowid))
    if (row === null) throw new Error('record id disappeared immediately after insert')
    return toRecordId(row)
  }

  async findByRecord(retroId: number, rid: string): Promise<RecordId | undefined> {
    const row = this.db
      .query<RecordIdRow, [number, string]>(
        `SELECT ${COLUMNS} FROM record_ids WHERE retro_id = ? AND rid = ?`,
      )
      .get(retroId, rid)
    return row === null ? undefined : toRecordId(row)
  }

  async findById(id: number): Promise<RecordId | undefined> {
    const row = this.db
      .query<RecordIdRow, [number]>(`SELECT ${COLUMNS} FROM record_ids WHERE id = ?`)
      .get(id)
    return row === null ? undefined : toRecordId(row)
  }

  async listByRetro(retroId: number): Promise<readonly RecordId[]> {
    return this.db
      .query<RecordIdRow, [number]>(
        `SELECT ${COLUMNS} FROM record_ids WHERE retro_id = ? ORDER BY id ASC`,
      )
      .all(retroId)
      .map(toRecordId)
  }

  async listAll(): Promise<readonly RecordId[]> {
    return this.db
      .query<RecordIdRow, []>(`SELECT ${COLUMNS} FROM record_ids ORDER BY id ASC`)
      .all()
      .map(toRecordId)
  }
}
