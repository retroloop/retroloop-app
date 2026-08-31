import type { Retrospective } from '#domain/models/retrospective.model'
import type { Revision } from '#domain/models/revision.model'
import type { Session, SessionStatus } from '#domain/models/session.model'
import type { RetrospectiveRepository } from '#domain/repositories/retrospective.repository'
import type { RevisionRepository } from '#domain/repositories/revision.repository'
import type { SessionRepository } from '#domain/repositories/session.repository'

/** Integer id, or the Claude session UUID — both address a session (cli.md). */
export type SessionRef = number | string

/**
 * How the adapters address a retrospective: by its own id, or by a session, which
 * means "that session's active retrospective" (cli.md §Conventions).
 */
export type RetroRef = { readonly retroId: number } | { readonly session: SessionRef }

export async function resolveSession(
  sessions: SessionRepository,
  ref: SessionRef,
): Promise<Session | undefined> {
  return typeof ref === 'number' ? sessions.findById(ref) : sessions.findByClaudeSession(ref)
}

/**
 * A session resolves to its one non-`finished` retrospective; when every
 * retrospective is finished it resolves to the most recent one, so reads like
 * `review status` and `export` keep working after a review closes.
 */
export async function resolveRetrospective(
  repositories: {
    readonly sessions: SessionRepository
    readonly retrospectives: RetrospectiveRepository
  },
  ref: RetroRef,
): Promise<Retrospective | undefined> {
  if ('retroId' in ref) return repositories.retrospectives.findById(ref.retroId)

  const session = await resolveSession(repositories.sessions, ref.session)
  if (session === undefined) return undefined
  return (
    (await repositories.retrospectives.findOpenBySession(session.id)) ??
    (await repositories.retrospectives.findLatestBySession(session.id))
  )
}

/**
 * A revision by number, or the latest one — the `--revision <n> [default: latest]`
 * of every read command (cli.md).
 */
export async function resolveRevision(
  revisions: RevisionRepository,
  retroId: number,
  n?: number,
): Promise<Revision | undefined> {
  return n === undefined
    ? revisions.findLatestByRetro(retroId)
    : revisions.findByRetroAndN(retroId, n)
}

/** Human-readable form of a reference, for error messages. */
export function describeRetroRef(ref: RetroRef): string | number {
  return 'retroId' in ref ? ref.retroId : ref.session
}

/**
 * A session's status is derived, never stored (data-model.md §Session): it is
 * `reviewing` while a retrospective of its is under review, `finished` once every
 * retrospective is finished, and `active` before any review starts.
 */
export function deriveSessionStatus(retrospectives: readonly Retrospective[]): SessionStatus {
  if (retrospectives.length === 0) return 'active'
  if (retrospectives.some((retro) => retro.state === 'reviewing')) return 'reviewing'
  if (retrospectives.every((retro) => retro.state === 'finished')) return 'finished'
  return 'active'
}
