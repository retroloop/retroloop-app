import type {
  NewRecordAttributeValueEntry,
  RecordAttributeValueEntry,
} from '#domain/models/record-attribute-value.model'
import type { RecordAttributeValueRepository } from '#domain/repositories/record-attribute-value.repository'
import { recordKey } from '#domain/services/record-key.service'
import { clone, type MemoryDatabase } from '#infrastructure/memory/memory-database'

export class MemoryRecordAttributeValueRepository implements RecordAttributeValueRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async add(entry: NewRecordAttributeValueEntry): Promise<RecordAttributeValueEntry> {
    const row: RecordAttributeValueEntry = { id: this.db.nextId(), ...entry }
    this.db.tables.recordAttributeValues.push(row)
    return clone(row)
  }

  /** Ordered by `id` — see the note on the label adapter's own `listForRecord`. */
  async listForRecord(retroId: number, rid: string): Promise<readonly RecordAttributeValueEntry[]> {
    return clone(
      this.db.tables.recordAttributeValues
        .filter((entry) => entry.retroId === retroId && entry.rid === rid)
        .sort((left, right) => left.id - right.id),
    )
  }

  async listLatestForEachRecord(): Promise<readonly RecordAttributeValueEntry[]> {
    const latest = new Map<string, RecordAttributeValueEntry>()
    for (const entry of this.db.tables.recordAttributeValues) {
      const key = `${recordKey(entry.retroId, entry.rid)} ${entry.attributeId}`
      const known = latest.get(key)
      if (known === undefined || entry.version > known.version) latest.set(key, entry)
    }
    return clone([...latest.values()].sort((left, right) => left.id - right.id))
  }
}
