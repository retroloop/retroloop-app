import type { NewRecordClaimEntry, RecordClaimEntry } from '#domain/models/record-claim.model'
import type { RecordClaimRepository } from '#domain/repositories/record-claim.repository'
import { recordKey } from '#domain/services/record-key.service'
import { clone, type MemoryDatabase } from '#infrastructure/memory/memory-database'

export class MemoryRecordClaimRepository implements RecordClaimRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async add(entry: NewRecordClaimEntry): Promise<RecordClaimEntry> {
    const row: RecordClaimEntry = { id: this.db.nextId(), ...entry }
    this.db.tables.recordClaims.push(row)
    return clone(row)
  }

  async findLatest(retroId: number, rid: string): Promise<RecordClaimEntry | undefined> {
    return clone(
      this.db.tables.recordClaims
        .filter((entry) => entry.retroId === retroId && entry.rid === rid)
        .sort((left, right) => right.version - left.version)
        .at(0),
    )
  }

  async listLatestForEachRecord(): Promise<readonly RecordClaimEntry[]> {
    const latest = new Map<string, RecordClaimEntry>()
    for (const entry of this.db.tables.recordClaims) {
      // Keyed the way the SQL groups: on `(retroId, rid)`, because a rid is
      // minted per retrospective and two retrospectives may both hold an
      // `r-stale-lock`.
      const key = recordKey(entry.retroId, entry.rid)
      const known = latest.get(key)
      if (known === undefined || entry.version > known.version) latest.set(key, entry)
    }
    return clone([...latest.values()].sort((left, right) => left.id - right.id))
  }
}
