import type { Database } from 'bun:sqlite'
import type { Actor } from '#domain/models/actor.model'
import type { NewRecordClaimEntry, RecordClaimEntry } from '#domain/models/record-claim.model'
import type { RecordClaimRepository } from '#domain/repositories/record-claim.repository'
import { checked, fromBit, toBit } from '#infrastructure/sqlite/rows'

type ClaimRow = {
  id: number
  retro_id: number
  rid: string
  version: number
  claimed: number
  actor: string
  at: string
}

const COLUMNS = 'id, retro_id, rid, version, claimed, actor, at'

function toEntry(row: ClaimRow): RecordClaimEntry {
  return {
    id: row.id,
    retroId: row.retro_id,
    rid: row.rid,
    version: row.version,
    // SQLite has no boolean, so this is a 0/1 column and both directions of the
    // conversion are proven in the contract suite — a `false` that came back as
    // `0` would be truthy above L1 and would leave every released record looking
    // held by somebody.
    claimed: fromBit(row.claimed),
    // The CHECK on the column is what makes this narrowing true, and it is the
    // same one `record_lifecycle` relies on: nothing but `ai` or `human` reaches
    // the table, whatever opens the database.
    actor: checked<Actor>(row.actor),
    at: row.at,
  }
}

/**
 * Append-only, and the table's triggers say so too: this adapter has `add` and
 * two reads, and the database rejects `UPDATE`/`DELETE` on the table even from a
 * writer that never came through here.
 */
export class SqliteRecordClaimRepository implements RecordClaimRepository {
  constructor(private readonly db: Database) {}

  async add(entry: NewRecordClaimEntry): Promise<RecordClaimEntry> {
    const { lastInsertRowid } = this.db.run(
      `INSERT INTO record_claims (retro_id, rid, version, claimed, actor, at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [entry.retroId, entry.rid, entry.version, toBit(entry.claimed), entry.actor, entry.at],
    )
    const row = this.db
      .query<ClaimRow, [number]>(`SELECT ${COLUMNS} FROM record_claims WHERE id = ?`)
      .get(Number(lastInsertRowid))
    if (row === null) throw new Error('record claim entry disappeared immediately after insert')
    return toEntry(row)
  }

  async findLatest(retroId: number, rid: string): Promise<RecordClaimEntry | undefined> {
    const row = this.db
      .query<ClaimRow, [number, string]>(
        `SELECT ${COLUMNS} FROM record_claims
         WHERE retro_id = ? AND rid = ?
         ORDER BY version DESC LIMIT 1`,
      )
      .get(retroId, rid)
    return row === null ? undefined : toEntry(row)
  }

  /** The correlated-MAX pattern `record_lifecycle` uses, keyed the same way. */
  async listLatestForEachRecord(): Promise<readonly RecordClaimEntry[]> {
    return this.db
      .query<ClaimRow, []>(
        `SELECT ${COLUMNS} FROM record_claims c
         WHERE c.version = (SELECT MAX(v.version) FROM record_claims v
                            WHERE v.retro_id = c.retro_id AND v.rid = c.rid)
         ORDER BY c.id ASC`,
      )
      .all()
      .map(toEntry)
  }
}
