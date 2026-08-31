import type { Database } from 'bun:sqlite'
import type { FinishMessage, NewFinishMessage } from '#domain/models/finish-message.model'
import type { FinishMessageRepository } from '#domain/repositories/finish-message.repository'

type FinishMessageRow = {
  id: number
  retro_id: number
  revision_n: number
  version: number
  message: string
  at: string
}

const COLUMNS = 'id, retro_id, revision_n, version, message, at'

function toFinishMessage(row: FinishMessageRow): FinishMessage {
  return {
    id: row.id,
    retroId: row.retro_id,
    revisionN: row.revision_n,
    version: row.version,
    message: row.message,
    at: row.at,
  }
}

/**
 * Append-only, and the table's triggers say so too: this adapter has `add` and
 * two reads, and the database rejects `UPDATE`/`DELETE` on the table even from a
 * writer that never came through here.
 */
export class SqliteFinishMessageRepository implements FinishMessageRepository {
  constructor(private readonly db: Database) {}

  async add(message: NewFinishMessage): Promise<FinishMessage> {
    const { lastInsertRowid } = this.db.run(
      `INSERT INTO finish_messages (retro_id, revision_n, version, message, at)
       VALUES (?, ?, ?, ?, ?)`,
      [message.retroId, message.revisionN, message.version, message.message, message.at],
    )
    const row = this.db
      .query<FinishMessageRow, [number]>(`SELECT ${COLUMNS} FROM finish_messages WHERE id = ?`)
      .get(Number(lastInsertRowid))
    if (row === null) throw new Error('finish message disappeared immediately after insert')
    return toFinishMessage(row)
  }

  async findLatest(retroId: number, revisionN: number): Promise<FinishMessage | undefined> {
    const row = this.db
      .query<FinishMessageRow, [number, number]>(
        `SELECT ${COLUMNS} FROM finish_messages
         WHERE retro_id = ? AND revision_n = ?
         ORDER BY version DESC LIMIT 1`,
      )
      .get(retroId, revisionN)
    return row === null ? undefined : toFinishMessage(row)
  }

  /** One query for every round of the retrospective rather than one per round. */
  async listLatestByRetro(retroId: number): Promise<readonly FinishMessage[]> {
    return this.db
      .query<FinishMessageRow, [number]>(
        `SELECT ${COLUMNS} FROM finish_messages m
         WHERE m.retro_id = ?
           AND m.version = (SELECT MAX(v.version) FROM finish_messages v
                            WHERE v.retro_id = m.retro_id AND v.revision_n = m.revision_n)
         ORDER BY m.revision_n ASC`,
      )
      .all(retroId)
      .map(toFinishMessage)
  }
}
