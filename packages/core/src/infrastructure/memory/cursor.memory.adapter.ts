import type { Cursor, CursorRepository } from '#domain/repositories/cursor.repository'
import { clone, type MemoryDatabase } from '#infrastructure/memory/memory-database'

export class MemoryCursorRepository implements CursorRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async find(name: string): Promise<Cursor | undefined> {
    return clone(this.db.tables.cursors.find((cursor) => cursor.name === name))
  }

  async save(cursor: Cursor): Promise<Cursor> {
    const index = this.db.tables.cursors.findIndex((existing) => existing.name === cursor.name)
    if (index === -1) this.db.tables.cursors.push({ ...cursor })
    else this.db.tables.cursors[index] = { ...cursor }
    return clone(cursor)
  }
}
