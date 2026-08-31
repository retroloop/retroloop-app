import type { Session, SessionStatus } from '#domain/models/session.model'

/** A session with its derived status — the shape the dashboard and `session list` read. */
export type SessionView = {
  readonly session: Session
  readonly status: SessionStatus
  readonly retrospectives: number
}
