import type { Database } from 'bun:sqlite'
import type { Actor } from '#domain/models/actor.model'
import type {
  NewRecordLifecycleEntry,
  RecordLifecycleEntry,
  RecordLifecycleStatus,
} from '#domain/models/record-lifecycle.model'
import type { RecordLifecycleRepository } from '#domain/repositories/record-lifecycle.repository'
import { checked, optionalText, parseJson } from '#infrastructure/sqlite/rows'

type LifecycleRow = {
  id: number
  retro_id: number
  rid: string
  version: number
  status: string
  refs: string
  note: string | null
  actor: string
  at: string
}

const COLUMNS = 'id, retro_id, rid, version, status, refs, note, actor, at'

function toEntry(row: LifecycleRow): RecordLifecycleEntry {
  return {
    id: row.id,
    retroId: row.retro_id,
    rid: row.rid,
    version: row.version,
    status: checked<RecordLifecycleStatus>(row.status),
    // A JSON column with `CHECK (json_valid(refs))`, the way `revisions.records`
    // is: the domain holds a list of free text, and SQLite has no array.
    refs: parseJson<string[]>(row.refs),
    note: optionalText(row.note),
    actor: checked<Actor>(row.actor),
    at: row.at,
  }
}

/**
 * Append-only, and the table's triggers say so too: this adapter has `add` and
 * three reads, and the database rejects `UPDATE`/`DELETE` on the table even from a
 * writer that never came through here — including the AI, which is a first-class
 * author of these rows rather than a rogue one.
 */
export class SqliteRecordLifecycleRepository implements RecordLifecycleRepository {
  constructor(private readonly db: Database) {}

  async add(entry: NewRecordLifecycleEntry): Promise<RecordLifecycleEntry> {
    const { lastInsertRowid } = this.db.run(
      `INSERT INTO record_lifecycle (retro_id, rid, version, status, refs, note, actor, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.retroId,
        entry.rid,
        entry.version,
        entry.status,
        JSON.stringify(entry.refs),
        entry.note ?? null,
        entry.actor,
        entry.at,
      ],
    )
    const row = this.db
      .query<LifecycleRow, [number]>(`SELECT ${COLUMNS} FROM record_lifecycle WHERE id = ?`)
      .get(Number(lastInsertRowid))
    if (row === null) throw new Error('record lifecycle entry disappeared immediately after insert')
    return toEntry(row)
  }

  async findLatest(retroId: number, rid: string): Promise<RecordLifecycleEntry | undefined> {
    const row = this.db
      .query<LifecycleRow, [number, string]>(
        `SELECT ${COLUMNS} FROM record_lifecycle
         WHERE retro_id = ? AND rid = ?
         ORDER BY version DESC LIMIT 1`,
      )
      .get(retroId, rid)
    return row === null ? undefined : toEntry(row)
  }

  async listForRecord(retroId: number, rid: string): Promise<readonly RecordLifecycleEntry[]> {
    return this.db
      .query<LifecycleRow, [number, string]>(
        `SELECT ${COLUMNS} FROM record_lifecycle
         WHERE retro_id = ? AND rid = ?
         ORDER BY version ASC`,
      )
      .all(retroId, rid)
      .map(toEntry)
  }

  /** The correlated-MAX pattern `decisions.listLatestForEachRetro` uses, keyed the same way. */
  async listLatestForEachRecord(): Promise<readonly RecordLifecycleEntry[]> {
    return this.db
      .query<LifecycleRow, []>(
        `SELECT ${COLUMNS} FROM record_lifecycle l
         WHERE l.version = (SELECT MAX(v.version) FROM record_lifecycle v
                            WHERE v.retro_id = l.retro_id AND v.rid = l.rid)
         ORDER BY l.id ASC`,
      )
      .all()
      .map(toEntry)
  }
}
