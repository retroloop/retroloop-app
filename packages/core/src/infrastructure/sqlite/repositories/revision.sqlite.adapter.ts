import type { Database } from 'bun:sqlite'
import type { RetroRecord } from '#domain/models/record.model'
import type { NewRevision, Revision } from '#domain/models/revision.model'
import type { RevisionRepository } from '#domain/repositories/revision.repository'
import { optionalText, parseJson } from '#infrastructure/sqlite/rows'

type RevisionRow = {
  id: number
  retro_id: number
  n: number
  created_at: string
  title: string | null
  records: string
}

const COLUMNS = 'id, retro_id, n, created_at, title, records'

function toRevision(row: RevisionRow): Revision {
  return {
    id: row.id,
    retroId: row.retro_id,
    n: row.n,
    createdAt: row.created_at,
    title: optionalText(row.title),
    records: parseJson<RetroRecord[]>(row.records),
  }
}

/**
 * Revisions are immutable (D4): this adapter can insert and read, and there is no
 * statement anywhere in it that updates or deletes one.
 */
export class SqliteRevisionRepository implements RevisionRepository {
  constructor(private readonly db: Database) {}

  async add(revision: NewRevision): Promise<Revision> {
    const { lastInsertRowid } = this.db.run(
      'INSERT INTO revisions (retro_id, n, created_at, title, records) VALUES (?, ?, ?, ?, ?)',
      [
        revision.retroId,
        revision.n,
        revision.createdAt,
        revision.title ?? null,
        JSON.stringify(revision.records),
      ],
    )
    const row = this.db
      .query<RevisionRow, [number]>(`SELECT ${COLUMNS} FROM revisions WHERE id = ?`)
      .get(Number(lastInsertRowid))
    if (row === null) throw new Error('revision disappeared immediately after insert')
    return toRevision(row)
  }

  async findByRetroAndN(retroId: number, n: number): Promise<Revision | undefined> {
    const row = this.db
      .query<RevisionRow, [number, number]>(
        `SELECT ${COLUMNS} FROM revisions WHERE retro_id = ? AND n = ?`,
      )
      .get(retroId, n)
    return row === null ? undefined : toRevision(row)
  }

  async findLatestByRetro(retroId: number): Promise<Revision | undefined> {
    const row = this.db
      .query<RevisionRow, [number]>(
        `SELECT ${COLUMNS} FROM revisions WHERE retro_id = ? ORDER BY n DESC LIMIT 1`,
      )
      .get(retroId)
    return row === null ? undefined : toRevision(row)
  }

  /**
   * One statement for the whole dashboard: the highest `n` of each `retro_id`,
   * found by correlated subquery rather than by asking per retrospective.
   */
  async listLatestForEachRetro(): Promise<readonly Revision[]> {
    return this.db
      .query<RevisionRow, []>(
        `SELECT ${COLUMNS} FROM revisions r
         WHERE r.n = (SELECT MAX(v.n) FROM revisions v WHERE v.retro_id = r.retro_id)
         ORDER BY r.retro_id ASC`,
      )
      .all()
      .map(toRevision)
  }

  async listByRetro(retroId: number): Promise<readonly Revision[]> {
    return this.db
      .query<RevisionRow, [number]>(
        `SELECT ${COLUMNS} FROM revisions WHERE retro_id = ? ORDER BY n ASC`,
      )
      .all(retroId)
      .map(toRevision)
  }

  async countByRetro(retroId: number): Promise<number> {
    return (
      this.db
        .query<{ total: number }, [number]>(
          'SELECT COUNT(*) AS total FROM revisions WHERE retro_id = ?',
        )
        .get(retroId)?.total ?? 0
    )
  }
}
