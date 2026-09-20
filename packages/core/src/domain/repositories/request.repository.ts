import type { NewRequest, NewRequestResponse, Request } from '#domain/models/request.model'

export type RequestListFilter = {
  readonly openOnly?: boolean
}

/**
 * Messages are append-only; `close` flips the state and stamps `closedAt` —
 * a state change, never a deletion, and only the human may ask for it.
 */
export type RequestRepository = {
  add(request: NewRequest): Promise<Request>
  /** Returns `undefined` if the request is gone. */
  addResponse(requestId: number, response: NewRequestResponse): Promise<Request | undefined>
  /** Returns `undefined` if the request is gone. */
  close(requestId: number, closedAt: string): Promise<Request | undefined>
  findById(id: number): Promise<Request | undefined>
  /** Oldest first. */
  listByRetro(retroId: number, filter?: RequestListFilter): Promise<readonly Request[]>
}
