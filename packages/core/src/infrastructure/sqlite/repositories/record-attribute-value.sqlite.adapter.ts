import type { Database } from 'bun:sqlite'
import type {
  NewRecordAttributeValueEntry,
  RecordAttributeValueEntry,
} from '#domain/models/record-attribute-value.model'
import type { RecordAttributeValueRepository } from '#domain/repositories/record-attribute-value.repository'
import { optionalText } from '#infrastructure/sqlite/rows'

type ValueRow = {
  id: number
  retro_id: number
  rid: string
  attribute_id: number
  version: number
  value: string | null
  at: string
}

const COLUMNS = 'id, retro_id, rid, attribute_id, version, value, at'

function toEntry(row: ValueRow): RecordAttributeValueEntry {
  return {
    id: row.id,
    retroId: row.retro_id,
    rid: row.rid,
    attributeId: row.attribute_id,
    version: row.version,
    // NULL is the act of clearing, and it has to survive the round trip as
    // `undefined` rather than as `''` — "no longer points at a ticket" and
    // "points at the empty string" are different claims.
    value: optionalText(row.value),
    at: row.at,
  }
}

export class SqliteRecordAttributeValueRepository implements RecordAttributeValueRepository {
  constructor(private readonly db: Database) {}

  async add(entry: NewRecordAttributeValueEntry): Promise<RecordAttributeValueEntry> {
    const { lastInsertRowid } = this.db.run(
      `INSERT INTO record_attribute_values (retro_id, rid, attribute_id, version, value, at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [entry.retroId, entry.rid, entry.attributeId, entry.version, entry.value ?? null, entry.at],
    )
    const row = this.db
      .query<ValueRow, [number]>(`SELECT ${COLUMNS} FROM record_attribute_values WHERE id = ?`)
      .get(Number(lastInsertRowid))
    if (row === null) throw new Error('attribute value entry disappeared immediately after insert')
    return toEntry(row)
  }

  /** `ORDER BY id` — see the note on the label adapter's own `listForRecord`. */
  async listForRecord(retroId: number, rid: string): Promise<readonly RecordAttributeValueEntry[]> {
    return this.db
      .query<ValueRow, [number, string]>(
        `SELECT ${COLUMNS} FROM record_attribute_values
         WHERE retro_id = ? AND rid = ?
         ORDER BY id ASC`,
      )
      .all(retroId, rid)
      .map(toEntry)
  }

  async listLatestForEachRecord(): Promise<readonly RecordAttributeValueEntry[]> {
    return this.db
      .query<ValueRow, []>(
        `SELECT ${COLUMNS} FROM record_attribute_values a
         WHERE a.version = (SELECT MAX(v.version) FROM record_attribute_values v
                            WHERE v.retro_id = a.retro_id
                              AND v.rid = a.rid
                              AND v.attribute_id = a.attribute_id)
         ORDER BY a.id ASC`,
      )
      .all()
      .map(toEntry)
  }
}
