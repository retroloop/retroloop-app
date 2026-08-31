import type { NewRevision, Revision } from '#domain/models/revision.model'
import type { RevisionRepository } from '#domain/repositories/revision.repository'
import { clone, type MemoryDatabase } from '#infrastructure/memory/memory-database'

export class MemoryRevisionRepository implements RevisionRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async add(revision: NewRevision): Promise<Revision> {
    const row: Revision = { id: this.db.nextId(), ...clone(revision) }
    this.db.tables.revisions.push(row)
    return clone(row)
  }

  async findByRetroAndN(retroId: number, n: number): Promise<Revision | undefined> {
    return clone(
      this.db.tables.revisions.find((revision) => revision.retroId === retroId && revision.n === n),
    )
  }

  async findLatestByRetro(retroId: number): Promise<Revision | undefined> {
    return clone(
      this.db.tables.revisions
        .filter((revision) => revision.retroId === retroId)
        .sort((left, right) => right.n - left.n)
        .at(0),
    )
  }

  async listLatestForEachRetro(): Promise<readonly Revision[]> {
    const latest = new Map<number, Revision>()
    for (const revision of this.db.tables.revisions) {
      const known = latest.get(revision.retroId)
      if (known === undefined || revision.n > known.n) latest.set(revision.retroId, revision)
    }
    return clone([...latest.values()].sort((left, right) => left.retroId - right.retroId))
  }

  async listByRetro(retroId: number): Promise<readonly Revision[]> {
    return clone(
      this.db.tables.revisions
        .filter((revision) => revision.retroId === retroId)
        .sort((left, right) => left.n - right.n),
    )
  }

  async countByRetro(retroId: number): Promise<number> {
    return this.db.tables.revisions.filter((revision) => revision.retroId === retroId).length
  }
}
