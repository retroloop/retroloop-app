import type { Database } from 'bun:sqlite'
import type { NewRecordLabelEntry, RecordLabelEntry } from '#domain/models/record-label.model'
import type { RecordLabelRepository } from '#domain/repositories/record-label.repository'
import { fromBit, toBit } from '#infrastructure/sqlite/rows'

type LabelEntryRow = {
  id: number
  retro_id: number
  rid: string
  label_id: number
  version: number
  applied: number
  at: string
}

const COLUMNS = 'id, retro_id, rid, label_id, version, applied, at'

function toEntry(row: LabelEntryRow): RecordLabelEntry {
  return {
    id: row.id,
    retroId: row.retro_id,
    rid: row.rid,
    labelId: row.label_id,
    version: row.version,
    // SQLite has no boolean, so this is a 0/1 column and both directions of the
    // conversion are proven in the contract suite — a `false` that came back as
    // `0` would be truthy above L1 and would put every removed label back on.
    applied: fromBit(row.applied),
    at: row.at,
  }
}

export class SqliteRecordLabelRepository implements RecordLabelRepository {
  constructor(private readonly db: Database) {}

  async add(entry: NewRecordLabelEntry): Promise<RecordLabelEntry> {
    const { lastInsertRowid } = this.db.run(
      `INSERT INTO record_labels (retro_id, rid, label_id, version, applied, at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [entry.retroId, entry.rid, entry.labelId, entry.version, toBit(entry.applied), entry.at],
    )
    const row = this.db
      .query<LabelEntryRow, [number]>(`SELECT ${COLUMNS} FROM record_labels WHERE id = ?`)
      .get(Number(lastInsertRowid))
    if (row === null) throw new Error('record label entry disappeared immediately after insert')
    return toEntry(row)
  }

  /**
   * `ORDER BY id`, not `ORDER BY version`: the version sequence is dense **per
   * label**, so a record wearing three labels holds three independent v1 rows
   * and ordering by version would interleave three histories into nonsense.
   */
  async listForRecord(retroId: number, rid: string): Promise<readonly RecordLabelEntry[]> {
    return this.db
      .query<LabelEntryRow, [number, string]>(
        `SELECT ${COLUMNS} FROM record_labels
         WHERE retro_id = ? AND rid = ?
         ORDER BY id ASC`,
      )
      .all(retroId, rid)
      .map(toEntry)
  }

  /**
   * The correlated-MAX pattern the lifecycle table uses, grouped one column
   * wider: `(retro_id, rid, label_id)`, because each `(record, label)` pair has
   * a version sequence of its own.
   */
  async listLatestForEachRecord(): Promise<readonly RecordLabelEntry[]> {
    return this.db
      .query<LabelEntryRow, []>(
        `SELECT ${COLUMNS} FROM record_labels l
         WHERE l.version = (SELECT MAX(v.version) FROM record_labels v
                            WHERE v.retro_id = l.retro_id
                              AND v.rid = l.rid
                              AND v.label_id = l.label_id)
         ORDER BY l.id ASC`,
      )
      .all()
      .map(toEntry)
  }
}
