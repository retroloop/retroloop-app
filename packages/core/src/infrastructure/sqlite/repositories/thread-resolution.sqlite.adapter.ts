import type { Database } from 'bun:sqlite'
import type { NewThreadResolution, ThreadResolution } from '#domain/models/thread-resolution.model'
import type { ThreadResolutionRepository } from '#domain/repositories/thread-resolution.repository'
import { fromBit, toBit } from '#infrastructure/sqlite/rows'

type ResolutionRow = {
  id: number
  thread_id: number
  version: number
  resolved: number
  at: string
}

const COLUMNS = 'id, thread_id, version, resolved, at'

function toResolution(row: ResolutionRow): ThreadResolution {
  return {
    id: row.id,
    threadId: row.thread_id,
    version: row.version,
    resolved: fromBit(row.resolved),
    at: row.at,
  }
}

/**
 * Append-only, and the table's triggers say so too: this adapter has `add` and
 * two reads, and the database rejects `UPDATE`/`DELETE` on the table even from a
 * writer that never came through here.
 */
export class SqliteThreadResolutionRepository implements ThreadResolutionRepository {
  constructor(private readonly db: Database) {}

  async add(resolution: NewThreadResolution): Promise<ThreadResolution> {
    const { lastInsertRowid } = this.db.run(
      `INSERT INTO thread_resolutions (thread_id, version, resolved, at)
       VALUES (?, ?, ?, ?)`,
      [resolution.threadId, resolution.version, toBit(resolution.resolved), resolution.at],
    )
    const row = this.db
      .query<ResolutionRow, [number]>(`SELECT ${COLUMNS} FROM thread_resolutions WHERE id = ?`)
      .get(Number(lastInsertRowid))
    if (row === null) throw new Error('thread resolution disappeared immediately after insert')
    return toResolution(row)
  }

  async findLatest(threadId: number): Promise<ThreadResolution | undefined> {
    const row = this.db
      .query<ResolutionRow, [number]>(
        `SELECT ${COLUMNS} FROM thread_resolutions
         WHERE thread_id = ?
         ORDER BY version DESC LIMIT 1`,
      )
      .get(threadId)
    return row === null ? undefined : toResolution(row)
  }

  /** One query for a page of threads rather than one per thread. */
  async listLatestForThreads(threadIds: readonly number[]): Promise<readonly ThreadResolution[]> {
    if (threadIds.length === 0) return []

    const placeholders = threadIds.map(() => '?').join(', ')
    return this.db
      .query<ResolutionRow, number[]>(
        `SELECT ${COLUMNS} FROM thread_resolutions r
         WHERE r.thread_id IN (${placeholders})
           AND r.version = (SELECT MAX(v.version) FROM thread_resolutions v
                            WHERE v.thread_id = r.thread_id)
         ORDER BY r.thread_id ASC`,
      )
      .all(...threadIds)
      .map(toResolution)
  }
}
