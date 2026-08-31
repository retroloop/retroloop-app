import type {
  NewRecordLifecycleEntry,
  RecordLifecycleEntry,
} from '#domain/models/record-lifecycle.model'
import type { RecordLifecycleRepository } from '#domain/repositories/record-lifecycle.repository'
import { lifecycleKey } from '#domain/services/record-lifecycle.service'
import { clone, type MemoryDatabase } from '#infrastructure/memory/memory-database'

export class MemoryRecordLifecycleRepository implements RecordLifecycleRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async add(entry: NewRecordLifecycleEntry): Promise<RecordLifecycleEntry> {
    const row: RecordLifecycleEntry = { id: this.db.nextId(), ...entry }
    this.db.tables.recordLifecycle.push(row)
    return clone(row)
  }

  async findLatest(retroId: number, rid: string): Promise<RecordLifecycleEntry | undefined> {
    return clone(
      this.db.tables.recordLifecycle
        .filter((entry) => entry.retroId === retroId && entry.rid === rid)
        .sort((left, right) => right.version - left.version)
        .at(0),
    )
  }

  async listForRecord(retroId: number, rid: string): Promise<readonly RecordLifecycleEntry[]> {
    return clone(
      this.db.tables.recordLifecycle
        .filter((entry) => entry.retroId === retroId && entry.rid === rid)
        .sort((left, right) => left.version - right.version),
    )
  }

  async listLatestForEachRecord(): Promise<readonly RecordLifecycleEntry[]> {
    const latest = new Map<string, RecordLifecycleEntry>()
    for (const entry of this.db.tables.recordLifecycle) {
      // Keyed the way the SQL groups: on `(retroId, rid)`, because a rid is
      // minted per retrospective and two retrospectives may both hold an
      // `r-flaky-test`.
      const key = lifecycleKey(entry.retroId, entry.rid)
      const known = latest.get(key)
      if (known === undefined || entry.version > known.version) latest.set(key, entry)
    }
    return clone([...latest.values()].sort((left, right) => left.id - right.id))
  }
}
