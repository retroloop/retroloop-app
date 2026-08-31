import type { Database } from 'bun:sqlite'
import type {
  NewRequest,
  NewRequestResponse,
  Request,
  RequestResponse,
  RequestState,
} from '#domain/models/request.model'
import type { RequestListFilter, RequestRepository } from '#domain/repositories/request.repository'
import { checked, optionalNumber, optionalText } from '#infrastructure/sqlite/rows'

type RequestRow = {
  id: number
  retro_id: number
  text: string
  state: string
  opened_at: string
  closed_at: string | null
}

type ResponseRow = {
  id: number
  request_id: number
  text: string
  revision_n: number | null
  at: string
}

const REQUEST_COLUMNS = 'id, retro_id, text, state, opened_at, closed_at'
const RESPONSE_COLUMNS = 'id, request_id, text, revision_n, at'

function toResponse(row: ResponseRow): RequestResponse {
  return {
    id: row.id,
    requestId: row.request_id,
    text: row.text,
    revisionN: optionalNumber(row.revision_n),
    at: row.at,
  }
}

function toRequest(row: RequestRow, responses: readonly RequestResponse[]): Request {
  return {
    id: row.id,
    retroId: row.retro_id,
    text: row.text,
    state: checked<RequestState>(row.state),
    openedAt: row.opened_at,
    closedAt: optionalText(row.closed_at),
    responses,
  }
}

export class SqliteRequestRepository implements RequestRepository {
  constructor(private readonly db: Database) {}

  async add(request: NewRequest): Promise<Request> {
    const { lastInsertRowid } = this.db.run(
      'INSERT INTO requests (retro_id, text, state, opened_at, closed_at) VALUES (?, ?, ?, ?, ?)',
      [request.retroId, request.text, request.state, request.openedAt, request.closedAt ?? null],
    )
    const stored = await this.findById(Number(lastInsertRowid))
    if (stored === undefined) throw new Error('request disappeared immediately after insert')
    return stored
  }

  async addResponse(requestId: number, response: NewRequestResponse): Promise<Request | undefined> {
    if ((await this.findById(requestId)) === undefined) return undefined

    this.db.run(
      'INSERT INTO request_responses (request_id, text, revision_n, at) VALUES (?, ?, ?, ?)',
      [requestId, response.text, response.revisionN ?? null, response.at],
    )
    return this.findById(requestId)
  }

  /** A state change, not a deletion: every response survives it. */
  async close(requestId: number, closedAt: string): Promise<Request | undefined> {
    if ((await this.findById(requestId)) === undefined) return undefined

    this.db.run("UPDATE requests SET state = 'closed', closed_at = ? WHERE id = ?", [
      closedAt,
      requestId,
    ])
    return this.findById(requestId)
  }

  async findById(id: number): Promise<Request | undefined> {
    const row = this.db
      .query<RequestRow, [number]>(`SELECT ${REQUEST_COLUMNS} FROM requests WHERE id = ?`)
      .get(id)
    return row === null ? undefined : toRequest(row, this.responsesOf([row.id]).get(row.id) ?? [])
  }

  async listByRetro(retroId: number, filter: RequestListFilter = {}): Promise<readonly Request[]> {
    const rows = this.db
      .query<RequestRow, [number, number]>(
        `SELECT ${REQUEST_COLUMNS} FROM requests
         WHERE retro_id = ? AND (? = 0 OR state = 'open')
         ORDER BY id ASC`,
      )
      .all(retroId, filter.openOnly === true ? 1 : 0)

    const responses = this.responsesOf(rows.map((row) => row.id))
    return rows.map((row) => toRequest(row, responses.get(row.id) ?? []))
  }

  private responsesOf(requestIds: readonly number[]): Map<number, RequestResponse[]> {
    const grouped = new Map<number, RequestResponse[]>()
    if (requestIds.length === 0) return grouped

    const placeholders = requestIds.map(() => '?').join(', ')
    const rows = this.db
      .query<ResponseRow, number[]>(
        `SELECT ${RESPONSE_COLUMNS} FROM request_responses
         WHERE request_id IN (${placeholders})
         ORDER BY id ASC`,
      )
      .all(...requestIds)

    for (const row of rows) {
      const response = toResponse(row)
      const existing = grouped.get(response.requestId)
      if (existing === undefined) grouped.set(response.requestId, [response])
      else existing.push(response)
    }
    return grouped
  }
}
