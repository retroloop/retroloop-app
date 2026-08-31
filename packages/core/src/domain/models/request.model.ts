/**
 * A top-level human ask on a review ("add X to the next revision"). The AI
 * responds — optionally citing the revision that addresses it — and **only the
 * human closes it**, in the UI (data-model.md §Notes, annotations, requests).
 *
 * Closing is a state change, not a deletion; the responses stay forever.
 */
export type RequestState = 'open' | 'closed'

export type RequestResponse = {
  readonly id: number
  readonly requestId: number
  readonly text: string
  readonly revisionN: number | undefined
  readonly at: string
}

export type NewRequestResponse = Omit<RequestResponse, 'id'>

export type Request = {
  readonly id: number
  readonly retroId: number
  readonly text: string
  readonly state: RequestState
  readonly openedAt: string
  readonly closedAt: string | undefined
  readonly responses: readonly RequestResponse[]
}

export type NewRequest = Omit<Request, 'id' | 'responses'>
