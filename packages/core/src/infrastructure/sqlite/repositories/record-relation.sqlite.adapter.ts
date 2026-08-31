import type { Database } from 'bun:sqlite'
import type { Actor } from '#domain/models/actor.model'
import type {
  NewRecordRelationEntry,
  RecordRelationEntry,
} from '#domain/models/record-relation.model'
import type { RecordRelationRepository } from '#domain/repositories/record-relation.repository'
import { fromBit, toBit } from '#infrastructure/sqlite/rows'

type RelationRow = {
  id: number
  from_id: number
  to_id: number
  version: number
  applied: number
  how: string
  actor: string
  at: string
}

const COLUMNS = 'id, from_id, to_id, version, applied, how, actor, at'

function toEntry(row: RelationRow): RecordRelationEntry {
  return {
    id: row.id,
    fromId: row.from_id,
    toId: row.to_id,
    version: row.version,
    // SQLite has no boolean, so this is a 0/1 column and both directions of the
    // conversion are proven in the contract suite — a `false` that came back as
    // `0` would be truthy above L1 and would put every un-related pair back
    // together.
    applied: fromBit(row.applied),
    how: row.how,
    // The CHECK on the column is what makes this narrowing true, and it is the
    // same one `record_lifecycle` relies on: nothing but `ai` or `human` reaches
    // the table, whatever opens the database.
    actor: row.actor as Actor,
    at: row.at,
  }
}

export class SqliteRecordRelationRepository implements RecordRelationRepository {
  constructor(private readonly db: Database) {}

  async add(entry: NewRecordRelationEntry): Promise<RecordRelationEntry> {
    const { lastInsertRowid } = this.db.run(
      `INSERT INTO record_relations (from_id, to_id, version, applied, how, actor, at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.fromId,
        entry.toId,
        entry.version,
        toBit(entry.applied),
        entry.how,
        entry.actor,
        entry.at,
      ],
    )
    const row = this.db
      .query<RelationRow, [number]>(`SELECT ${COLUMNS} FROM record_relations WHERE id = ?`)
      .get(Number(lastInsertRowid))
    if (row === null) throw new Error('record relation entry disappeared immediately after insert')
    return toEntry(row)
  }

  /**
   * **Both columns, one query** — this is *"the relation reads from both sides"*
   * at the storage layer, and it is why the migration ships an index per side: a
   * single composite index would serve only the half of the `OR` that leads with
   * its first column.
   *
   * `ORDER BY id`, not `ORDER BY version`: the version sequence is dense **per
   * ordered pair**, so a record holding four relations holds four independent v1
   * rows and ordering by version would interleave four histories.
   */
  async listForRecord(recordId: number): Promise<readonly RecordRelationEntry[]> {
    return this.db
      .query<RelationRow, [number, number]>(
        `SELECT ${COLUMNS} FROM record_relations
         WHERE from_id = ? OR to_id = ?
         ORDER BY id ASC`,
      )
      .all(recordId, recordId)
      .map(toEntry)
  }

  /**
   * The correlated-MAX pattern the lifecycle and label tables use, grouped on
   * the ordered pair — the sequence this table's versions are dense in.
   */
  async listLatestForEachPair(): Promise<readonly RecordRelationEntry[]> {
    return this.db
      .query<RelationRow, []>(
        `SELECT ${COLUMNS} FROM record_relations r
         WHERE r.version = (SELECT MAX(v.version) FROM record_relations v
                            WHERE v.from_id = r.from_id
                              AND v.to_id = r.to_id)
         ORDER BY r.id ASC`,
      )
      .all()
      .map(toEntry)
  }
}
