import type { Database } from 'bun:sqlite'
import type { NewSettingEntry, SettingEntry, SettingKey } from '#domain/models/setting.model'
import type { SettingRepository } from '#domain/repositories/setting.repository'
import { checked } from '#infrastructure/sqlite/rows'

type SettingRow = {
  id: number
  key: string
  version: number
  value: string
  at: string
}

const COLUMNS = 'id, key, version, value, at'

function toEntry(row: SettingRow): SettingEntry {
  return {
    id: row.id,
    key: checked<SettingKey>(row.key),
    version: row.version,
    value: row.value,
    at: row.at,
  }
}

/**
 * Append-only, and the table's triggers say so: this adapter has `add` and one
 * read, and the database rejects `UPDATE`/`DELETE` on the table even from a
 * writer that never came through here — which is the point, because the writer
 * this guarantee is aimed at is an AI process with the file open
 * (`setting.model.ts`).
 */
export class SqliteSettingRepository implements SettingRepository {
  constructor(private readonly db: Database) {}

  async add(entry: NewSettingEntry): Promise<SettingEntry> {
    const { lastInsertRowid } = this.db.run(
      'INSERT INTO settings (key, version, value, at) VALUES (?, ?, ?, ?)',
      [entry.key, entry.version, entry.value, entry.at],
    )
    const row = this.db
      .query<SettingRow, [number]>(`SELECT ${COLUMNS} FROM settings WHERE id = ?`)
      .get(Number(lastInsertRowid))
    if (row === null) throw new Error('setting entry disappeared immediately after insert')
    return toEntry(row)
  }

  async findLatest(key: SettingKey): Promise<SettingEntry | undefined> {
    const row = this.db
      .query<SettingRow, [string]>(
        `SELECT ${COLUMNS} FROM settings WHERE key = ? ORDER BY version DESC LIMIT 1`,
      )
      .get(key)
    return row === null ? undefined : toEntry(row)
  }
}
