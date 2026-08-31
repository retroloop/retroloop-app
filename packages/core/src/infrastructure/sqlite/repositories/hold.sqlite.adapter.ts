import type { Database } from 'bun:sqlite'
import type { Hold, NewHold } from '#domain/models/hold.model'
import type { HoldRepository } from '#domain/repositories/hold.repository'
import { fromBit, optionalText, toBit } from '#infrastructure/sqlite/rows'

type HoldRow = {
  id: number
  retro_id: number
  rid: string
  version: number
  held: number
  note: string | null
  at: string
}

const COLUMNS = 'id, retro_id, rid, version, held, note, at'

function toHold(row: HoldRow): Hold {
  return {
    id: row.id,
    retroId: row.retro_id,
    rid: row.rid,
    version: row.version,
    held: fromBit(row.held),
    note: optionalText(row.note),
    at: row.at,
  }
}

/**
 * Append-only, and the table's triggers say so too: this adapter has `add` and
 * three reads, and the database rejects `UPDATE`/`DELETE` on the table even from
 * a writer that never came through here.
 */
export class SqliteHoldRepository implements HoldRepository {
  constructor(private readonly db: Database) {}

  async add(hold: NewHold): Promise<Hold> {
    const { lastInsertRowid } = this.db.run(
      `INSERT INTO holds (retro_id, rid, version, held, note, at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [hold.retroId, hold.rid, hold.version, toBit(hold.held), hold.note ?? null, hold.at],
    )
    const row = this.db
      .query<HoldRow, [number]>(`SELECT ${COLUMNS} FROM holds WHERE id = ?`)
      .get(Number(lastInsertRowid))
    if (row === null) throw new Error('hold disappeared immediately after insert')
    return toHold(row)
  }

  async findLatest(retroId: number, rid: string): Promise<Hold | undefined> {
    const row = this.db
      .query<HoldRow, [number, string]>(
        `SELECT ${COLUMNS} FROM holds
         WHERE retro_id = ? AND rid = ?
         ORDER BY version DESC LIMIT 1`,
      )
      .get(retroId, rid)
    return row === null ? undefined : toHold(row)
  }

  async listForRecord(retroId: number, rid: string): Promise<readonly Hold[]> {
    return this.db
      .query<HoldRow, [number, string]>(
        `SELECT ${COLUMNS} FROM holds
         WHERE retro_id = ? AND rid = ?
         ORDER BY version ASC`,
      )
      .all(retroId, rid)
      .map(toHold)
  }

  async listLatestByRetro(retroId: number): Promise<readonly Hold[]> {
    return this.db
      .query<HoldRow, [number]>(
        `SELECT ${COLUMNS} FROM holds h
         WHERE h.retro_id = ?
           AND h.version = (SELECT MAX(v.version) FROM holds v
                            WHERE v.retro_id = h.retro_id AND v.rid = h.rid)
         ORDER BY h.id ASC`,
      )
      .all(retroId)
      .map(toHold)
  }
}
