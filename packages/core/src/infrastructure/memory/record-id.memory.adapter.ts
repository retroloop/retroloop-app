import type { NewRecordId, RecordId } from '#domain/models/record-id.model'
import type { RecordIdRepository } from '#domain/repositories/record-id.repository'
import { clone, type MemoryDatabase } from '#infrastructure/memory/memory-database'

/**
 * The memory half of the global sequence.
 *
 * **It counts its own rows rather than drawing from `nextId()`**, which every
 * other memory repository does. The shared counter is fine for an opaque row id
 * — nothing above L1 asserts a `retroId` and the suites capture whatever they
 * are given — but this number is the one a human reads off the page and cites
 * back, and a store where it came out 7, 9, 11 instead of 1, 2, 3 would be a
 * store the suites cannot state an expected value against. `length + 1` is
 * exactly what `AUTOINCREMENT` does over an insert-only table, so both stores
 * answer the same sequence for the same mints, and the snapshot `tx` restores
 * the array on a rollback the way SQLite restores `sqlite_sequence`.
 *
 * (The one thing `AUTOINCREMENT` adds is never reusing a number after a delete.
 * Nothing deletes from this table — the triggers refuse — so the two agree
 * everywhere the product can reach.)
 *
 * The `(retroId, rid)` uniqueness the table enforces with a constraint is
 * enforced here in the open, so a caller that mints twice is refused by both
 * stores rather than by one.
 */
export class MemoryRecordIdRepository implements RecordIdRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async add(entry: NewRecordId): Promise<RecordId> {
    const existing = this.db.tables.recordIds.find(
      (row) => row.retroId === entry.retroId && row.rid === entry.rid,
    )
    if (existing !== undefined) {
      throw new Error(`record ${entry.rid} of retrospective ${entry.retroId} already has a number`)
    }

    const row: RecordId = { id: this.db.tables.recordIds.length + 1, ...entry }
    this.db.tables.recordIds.push(row)
    return clone(row)
  }

  async findByRecord(retroId: number, rid: string): Promise<RecordId | undefined> {
    return clone(this.db.tables.recordIds.find((row) => row.retroId === retroId && row.rid === rid))
  }

  async findById(id: number): Promise<RecordId | undefined> {
    return clone(this.db.tables.recordIds.find((row) => row.id === id))
  }

  async listByRetro(retroId: number): Promise<readonly RecordId[]> {
    return clone(
      this.db.tables.recordIds
        .filter((row) => row.retroId === retroId)
        .sort((left, right) => left.id - right.id),
    )
  }

  async listAll(): Promise<readonly RecordId[]> {
    return clone([...this.db.tables.recordIds].sort((left, right) => left.id - right.id))
  }
}
