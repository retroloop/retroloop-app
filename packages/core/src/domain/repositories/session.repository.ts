import type { NewSession, Session } from '#domain/models/session.model'

export type SessionListFilter = {
  readonly project?: string
  readonly limit?: number
}

/**
 * Session identity is write-once (data-model.md §Mutability matrix): there is no
 * update and no delete here, and the absence of those methods *is* the enforcement
 * at this layer.
 *
 * Misses return `undefined` — repositories never throw (repo-layout.md).
 */
export type SessionRepository = {
  add(session: NewSession): Promise<Session>
  findById(id: number): Promise<Session | undefined>
  /** The idempotency key of `session create` (cli.md). */
  findByClaudeSession(claudeSession: string): Promise<Session | undefined>
  /** Newest first. */
  list(filter?: SessionListFilter): Promise<readonly Session[]>
}
