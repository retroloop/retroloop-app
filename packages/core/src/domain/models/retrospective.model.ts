/**
 * One capture-and-review cycle inside a session. A session has 1..n; exactly one
 * may be non-`finished` at a time.
 *
 * State machine (D3, amended by `r-one-finish-button`):
 * `open → reviewing → finished`.
 * - `open → reviewing` on the first revision of this retrospective.
 * - `reviewing → reviewing` for any further revision. `ReviewFinished` is an
 *   event, not a transition: the human's one button closes *their* side of the
 *   round, and the round's outcome is what they wrote in it.
 * - `reviewing → finished` only through `ReviewClosed`, the AI's explicit close
 *   to export — which it may only take after their `ReviewFinished` for the
 *   latest revision, with every record decided and none asking to be rewritten
 *   (`close-review.use-case.ts`).
 *
 * `open` is transient: a retrospective is started and its first revision written
 * in the same unit of work, so no persisted retrospective is ever observed in
 * `open` unless that unit of work rolled back.
 */
/**
 * The three states one is stored in, as a value, so the schema every adapter
 * validates against is derived from this list rather than restating it
 * (`enums.schema.ts`). The wire restated it for a long while, and nothing would
 * have caught the drift.
 */
export const RETROSPECTIVE_STATES = ['open', 'reviewing', 'finished'] as const

export type RetrospectiveState = (typeof RETROSPECTIVE_STATES)[number]

export type Retrospective = {
  readonly id: number
  readonly sessionId: number
  readonly state: RetrospectiveState
  readonly startedAt: string
  readonly finishedAt: string | undefined
}

export type NewRetrospective = Omit<Retrospective, 'id'>
