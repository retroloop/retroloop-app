import type { NewThreadResolution, ThreadResolution } from '#domain/models/thread-resolution.model'
import type { ThreadResolutionRepository } from '#domain/repositories/thread-resolution.repository'
import { clone, type MemoryDatabase } from '#infrastructure/memory/memory-database'

export class MemoryThreadResolutionRepository implements ThreadResolutionRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async add(resolution: NewThreadResolution): Promise<ThreadResolution> {
    const row: ThreadResolution = { id: this.db.nextId(), ...resolution }
    this.db.tables.threadResolutions.push(row)
    return clone(row)
  }

  async findLatest(threadId: number): Promise<ThreadResolution | undefined> {
    return clone(
      this.db.tables.threadResolutions
        .filter((resolution) => resolution.threadId === threadId)
        .sort((left, right) => right.version - left.version)
        .at(0),
    )
  }

  async listLatestForThreads(threadIds: readonly number[]): Promise<readonly ThreadResolution[]> {
    const wanted = new Set(threadIds)
    const latest = new Map<number, ThreadResolution>()
    for (const resolution of this.db.tables.threadResolutions) {
      if (!wanted.has(resolution.threadId)) continue
      const known = latest.get(resolution.threadId)
      if (known === undefined || resolution.version > known.version) {
        latest.set(resolution.threadId, resolution)
      }
    }
    return clone([...latest.values()].sort((left, right) => left.threadId - right.threadId))
  }
}
