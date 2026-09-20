import type {
  NewRetrospective,
  Retrospective,
  RetrospectiveState,
} from '#domain/models/retrospective.model'

/**
 * The retrospective's `state` is one of the few mutable columns in the system —
 * a state machine, not an edit: `open → reviewing → finished`, forward only.
 * There is no delete.
 */
export type RetrospectiveRepository = {
  add(retrospective: NewRetrospective): Promise<Retrospective>
  findById(id: number): Promise<Retrospective | undefined>
  /** Oldest first. */
  listBySession(sessionId: number): Promise<readonly Retrospective[]>
  /**
   * The same, oldest first, across every session — what the dashboard's flat
   * list is built from. Unfiltered on purpose: nothing groups or
   * routes by project. Oldest first because "Retro #n within its session" is
   * countable in one pass over that order; the dashboard reverses it.
   */
  listAll(): Promise<readonly Retrospective[]>
  /** The session's one non-`finished` retrospective, if it has one. */
  findOpenBySession(sessionId: number): Promise<Retrospective | undefined>
  /** Most recently started, whatever its state. */
  findLatestBySession(sessionId: number): Promise<Retrospective | undefined>
  /** Returns `undefined` if the retrospective is gone. `finishedAt` is set only for `finished`. */
  setState(
    id: number,
    state: RetrospectiveState,
    finishedAt?: string,
  ): Promise<Retrospective | undefined>
}
