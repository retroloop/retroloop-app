/**
 * One Claude Code working session (GLOSSARY). Integer id; the Claude session UUID
 * is an attribute used once, at registration, as the idempotency key.
 */
export type Session = {
  readonly id: number
  readonly claudeSession: string
  /**
   * Dormant and optional: one project routinely holds several software
   * packages, so it was the wrong unit. Nothing routes, groups or filters by it,
   * and `cwd` — which Claude Code pins for the life of a session — is the
   * identity anchor instead.
   */
  readonly project: string | undefined
  readonly cwd: string
  readonly branch: string | undefined
  /** Interactive, human-attended session. A session-level fact, never per record. */
  readonly supervised: boolean
  readonly startedAt: string
}

export type NewSession = Omit<Session, 'id'>

/** Derived from the session's retrospectives — never stored (data-model.md §Session). */
export type SessionStatus = 'active' | 'reviewing' | 'finished'
