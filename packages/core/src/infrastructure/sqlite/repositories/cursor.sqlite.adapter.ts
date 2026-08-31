import type { Database } from 'bun:sqlite'
import type { Cursor, CursorRepository } from '#domain/repositories/cursor.repository'

type CursorRow = {
  name: string
  position: number
  updated_at: string
}

function toCursor(row: CursorRow): Cursor {
  return { name: row.name, position: row.position, updatedAt: row.updated_at }
}

export class SqliteCursorRepository implements CursorRepository {
  constructor(private readonly db: Database) {}

  async find(name: string): Promise<Cursor | undefined> {
    const row = this.db
      .query<CursorRow, [string]>('SELECT name, position, updated_at FROM cursors WHERE name = ?')
      .get(name)
    return row === null ? undefined : toCursor(row)
  }

  /**
   * Upsert: a cursor is created on first use and moved forever after. This is the
   * only `ON CONFLICT DO UPDATE` in the store, and it is here because a position
   * is the one thing meant to be overwritten.
   */
  async save(cursor: Cursor): Promise<Cursor> {
    this.db.run(
      `INSERT INTO cursors (name, position, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (name) DO UPDATE SET position = excluded.position, updated_at = excluded.updated_at`,
      [cursor.name, cursor.position, cursor.updatedAt],
    )
    const stored = await this.find(cursor.name)
    if (stored === undefined) throw new Error('cursor disappeared immediately after save')
    return stored
  }
}
