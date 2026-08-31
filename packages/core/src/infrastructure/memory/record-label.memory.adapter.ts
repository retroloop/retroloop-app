import type { NewRecordLabelEntry, RecordLabelEntry } from '#domain/models/record-label.model'
import type { RecordLabelRepository } from '#domain/repositories/record-label.repository'
import { recordKey } from '#domain/services/record-key.service'
import { clone, type MemoryDatabase } from '#infrastructure/memory/memory-database'

export class MemoryRecordLabelRepository implements RecordLabelRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async add(entry: NewRecordLabelEntry): Promise<RecordLabelEntry> {
    const row: RecordLabelEntry = { id: this.db.nextId(), ...entry }
    this.db.tables.recordLabels.push(row)
    return clone(row)
  }

  /**
   * Ordered by `id` rather than by `version`, which is what the SQL does too:
   * versions are dense **per label**, so a record wearing three labels holds
   * three independent v1 rows and ordering by version would interleave them
   * meaninglessly. Insertion order is the order the acts were taken in.
   */
  async listForRecord(retroId: number, rid: string): Promise<readonly RecordLabelEntry[]> {
    return clone(
      this.db.tables.recordLabels
        .filter((entry) => entry.retroId === retroId && entry.rid === rid)
        .sort((left, right) => left.id - right.id),
    )
  }

  async listLatestForEachRecord(): Promise<readonly RecordLabelEntry[]> {
    const latest = new Map<string, RecordLabelEntry>()
    for (const entry of this.db.tables.recordLabels) {
      // Keyed the way the SQL groups: on the record **and the label**, because
      // each `(record, label)` pair has a version sequence of its own.
      const key = `${recordKey(entry.retroId, entry.rid)} ${entry.labelId}`
      const known = latest.get(key)
      if (known === undefined || entry.version > known.version) latest.set(key, entry)
    }
    return clone([...latest.values()].sort((left, right) => left.id - right.id))
  }
}
