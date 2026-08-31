import type {
  NewRequest,
  NewRequestResponse,
  Request,
  RequestResponse,
} from '#domain/models/request.model'
import type { RequestListFilter, RequestRepository } from '#domain/repositories/request.repository'
import { clone, type MemoryDatabase } from '#infrastructure/memory/memory-database'

export class MemoryRequestRepository implements RequestRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async add(request: NewRequest): Promise<Request> {
    const row: Request = { id: this.db.nextId(), ...request, responses: [] }
    this.db.tables.requests.push(row)
    return clone(row)
  }

  async addResponse(requestId: number, response: NewRequestResponse): Promise<Request | undefined> {
    const index = this.db.tables.requests.findIndex((request) => request.id === requestId)
    const current = this.db.tables.requests[index]
    if (current === undefined) return undefined

    const row: RequestResponse = { id: this.db.nextId(), ...response, requestId }
    const updated: Request = { ...current, responses: [...current.responses, row] }
    this.db.tables.requests[index] = updated
    return clone(updated)
  }

  async close(requestId: number, closedAt: string): Promise<Request | undefined> {
    const index = this.db.tables.requests.findIndex((request) => request.id === requestId)
    const current = this.db.tables.requests[index]
    if (current === undefined) return undefined

    const updated: Request = { ...current, state: 'closed', closedAt }
    this.db.tables.requests[index] = updated
    return clone(updated)
  }

  async findById(id: number): Promise<Request | undefined> {
    return clone(this.db.tables.requests.find((request) => request.id === id))
  }

  async listByRetro(retroId: number, filter: RequestListFilter = {}): Promise<readonly Request[]> {
    return clone(
      this.db.tables.requests
        .filter(
          (request) =>
            request.retroId === retroId && (filter.openOnly !== true || request.state === 'open'),
        )
        .sort((left, right) => left.id - right.id),
    )
  }
}
