import type { Hold, NewHold } from '#domain/models/hold.model'
import type { HoldRepository } from '#domain/repositories/hold.repository'
import { clone, type MemoryDatabase } from '#infrastructure/memory/memory-database'

export class MemoryHoldRepository implements HoldRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async add(hold: NewHold): Promise<Hold> {
    const row: Hold = { id: this.db.nextId(), ...hold }
    this.db.tables.holds.push(row)
    return clone(row)
  }

  async findLatest(retroId: number, rid: string): Promise<Hold | undefined> {
    return clone(
      this.findVersions(retroId, rid)
        .sort((left, right) => right.version - left.version)
        .at(0),
    )
  }

  async listForRecord(retroId: number, rid: string): Promise<readonly Hold[]> {
    return clone(
      this.findVersions(retroId, rid).sort((left, right) => left.version - right.version),
    )
  }

  async listLatestByRetro(retroId: number): Promise<readonly Hold[]> {
    const latest = new Map<string, Hold>()
    for (const hold of this.db.tables.holds) {
      if (hold.retroId !== retroId) continue
      const known = latest.get(hold.rid)
      if (known === undefined || hold.version > known.version) latest.set(hold.rid, hold)
    }
    return clone([...latest.values()].sort((left, right) => left.id - right.id))
  }

  private findVersions(retroId: number, rid: string): Hold[] {
    return this.db.tables.holds.filter((hold) => hold.retroId === retroId && hold.rid === rid)
  }
}
