import type {
  NewRecordRelationEntry,
  RecordRelationEntry,
} from '#domain/models/record-relation.model'
import type { RecordRelationRepository } from '#domain/repositories/record-relation.repository'
import { relationKey } from '#domain/services/record-relation.service'
import { clone, type MemoryDatabase } from '#infrastructure/memory/memory-database'

export class MemoryRecordRelationRepository implements RecordRelationRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async add(entry: NewRecordRelationEntry): Promise<RecordRelationEntry> {
    const row: RecordRelationEntry = { id: this.db.nextId(), ...entry }
    this.db.tables.recordRelations.push(row)
    return clone(row)
  }

  /**
   * Both sides, which is what the SQL's `from_id = ? OR to_id = ?` does — the
   * read the whole feature turns on.
   *
   * Ordered by `id` rather than by `version`, again matching the SQL: versions
   * are dense **per ordered pair**, so ordering by version would interleave one
   * record's four relation histories.
   */
  async listForRecord(recordId: number): Promise<readonly RecordRelationEntry[]> {
    return clone(
      this.db.tables.recordRelations
        .filter((entry) => entry.fromId === recordId || entry.toId === recordId)
        .sort((left, right) => left.id - right.id),
    )
  }

  async listLatestForEachPair(): Promise<readonly RecordRelationEntry[]> {
    const latest = new Map<string, RecordRelationEntry>()
    for (const entry of this.db.tables.recordRelations) {
      // Keyed the way the SQL groups: on the **ordered** pair, because that is
      // the sequence each version is dense in.
      const key = relationKey(entry.fromId, entry.toId)
      const known = latest.get(key)
      if (known === undefined || entry.version > known.version) latest.set(key, entry)
    }
    return clone([...latest.values()].sort((left, right) => left.id - right.id))
  }
}
