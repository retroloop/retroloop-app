import type { Decision, NewDecision } from '#domain/models/decision.model'
import type { DecisionRepository } from '#domain/repositories/decision.repository'
import { clone, type MemoryDatabase } from '#infrastructure/memory/memory-database'

/**
 * The highest-version row per (retrospective, record), oldest row first — the
 * shape both "latest" reads want, differing only in what they hand it.
 */
function latestPerRecord(decisions: readonly Decision[]): readonly Decision[] {
  const latest = new Map<string, Decision>()
  for (const decision of decisions) {
    const key = `${decision.retroId}:${decision.rid}`
    const known = latest.get(key)
    if (known === undefined || decision.version > known.version) latest.set(key, decision)
  }
  return clone([...latest.values()].sort((left, right) => left.id - right.id))
}

export class MemoryDecisionRepository implements DecisionRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async add(decision: NewDecision): Promise<Decision> {
    const row: Decision = { id: this.db.nextId(), ...decision }
    this.db.tables.decisions.push(row)
    return clone(row)
  }

  async findLatest(retroId: number, rid: string): Promise<Decision | undefined> {
    return clone(
      this.findVersions(retroId, rid)
        .sort((left, right) => right.version - left.version)
        .at(0),
    )
  }

  async listForRecord(retroId: number, rid: string): Promise<readonly Decision[]> {
    return clone(
      this.findVersions(retroId, rid).sort((left, right) => left.version - right.version),
    )
  }

  async listLatestByRetro(retroId: number): Promise<readonly Decision[]> {
    return latestPerRecord(this.db.tables.decisions.filter((row) => row.retroId === retroId))
  }

  async listLatestForEachRetro(): Promise<readonly Decision[]> {
    return latestPerRecord(this.db.tables.decisions)
  }

  private findVersions(retroId: number, rid: string): Decision[] {
    return this.db.tables.decisions.filter(
      (decision) => decision.retroId === retroId && decision.rid === rid,
    )
  }
}
