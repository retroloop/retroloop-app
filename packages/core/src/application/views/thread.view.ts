import type { Comment, CommentThread } from '#domain/models/comment-thread.model'
import type { RecordSection } from '#domain/models/record.model'
import type { ThreadResolution } from '#domain/models/thread-resolution.model'
import type { RevisionRepository } from '#domain/repositories/revision.repository'
import type { ThreadResolutionRepository } from '#domain/repositories/thread-resolution.repository'

/** All the derivation needs from a revision: its number and when it was filed. */
export type RevisionStamp = {
  readonly n: number
  readonly createdAt: string
}

/**
 * A message with a revision number on it, always.
 *
 * `revision` is the stored `revisionN` when the writer captured one, and a
 * derivation when they did not — see `effectiveRevision`. It is a number rather
 * than `number | null` on purpose: every reader wants to print "rev 2", and a
 * key that is sometimes absent is a fallback every reader has to invent for
 * itself, differently.
 */
export type ThreadMessageView = Comment & {
  readonly revision: number
}

/**
 * A thread as a reader sees it: its anchor, its messages each carrying the
 * revision they belong to, and whether the human has marked it dealt with.
 *
 * Read models live here rather than inside one use case because five of them
 * return the same shape — `comment list`, `record get`, `revision get`,
 * `revision get --feedback-only` and the export — and both drivers type their
 * outputs against it. That is also what makes "which revision was this written
 * against" one definition rather than one per surface.
 */
export type ThreadView = {
  readonly id: number
  readonly retroId: number
  readonly rid: string | undefined
  readonly section: RecordSection | undefined
  readonly openedAt: string
  readonly messages: readonly ThreadMessageView[]
  /** The latest resolution version's value; `false` when nobody has marked it. */
  readonly resolved: boolean
}

/**
 * The revision a message belongs to: what the writer captured, or the revision
 * that was current when they wrote.
 *
 * **The derivation is not the same fact as the capture, and the difference is
 * worth stating.** It says which revision was *current* at that moment, not
 * which one the writer was *reading*: a new revision is announced and never
 * swapped in, so a reviewer can be pinned to `?rev=1` while revision 2
 * exists, and a comment they write then derives as 2. Every comment written
 * since `comments_add_revision` carries the real answer instead; the derivation
 * exists for the rows written before it, which are human data and are never
 * rewritten.
 *
 * A comment cannot predate revision 1 — a retrospective *is* its first revision
 * — so the search always finds one. The final fallback covers only a caller that
 * passed no revisions at all.
 */
export function effectiveRevision(comment: Comment, revisions: readonly RevisionStamp[]): number {
  if (comment.revisionN !== undefined) return comment.revisionN

  let derived: RevisionStamp | undefined
  for (const revision of revisions) {
    if (revision.createdAt > comment.at) continue
    if (derived === undefined || revision.n > derived.n) derived = revision
  }
  return derived?.n ?? 1
}

export function buildThreadView(
  thread: CommentThread,
  revisions: readonly RevisionStamp[],
  resolution: ThreadResolution | undefined,
): ThreadView {
  return {
    id: thread.id,
    retroId: thread.retroId,
    rid: thread.rid,
    section: thread.section,
    openedAt: thread.openedAt,
    messages: thread.messages.map((message) => ({
      ...message,
      revision: effectiveRevision(message, revisions),
    })),
    resolved: resolution?.resolved ?? false,
  }
}

export function buildThreadViews(
  threads: readonly CommentThread[],
  revisions: readonly RevisionStamp[],
  resolutions: readonly ThreadResolution[],
): readonly ThreadView[] {
  const latest = new Map(resolutions.map((resolution) => [resolution.threadId, resolution]))
  return threads.map((thread) => buildThreadView(thread, revisions, latest.get(thread.id)))
}

/**
 * The two reads every thread view needs, and the assembly, in one place.
 *
 * Five use cases return threads and every one of them would otherwise repeat
 * these three lines — which is exactly how "which revision" and "resolved"
 * become two definitions on two surfaces. It takes the repositories rather than
 * the `Store` so it works inside a unit of work and outside one alike.
 *
 * It reads whole revisions rather than a stamp projection because a
 * retrospective has a handful of them — three is a long review — and a
 * `listStampsByRetro` would be a method for both adapters to implement, and for
 * the contract suite to hold them to, in exchange for not parsing a few JSON
 * columns.
 */
export async function loadThreadViews(
  repositories: {
    readonly revisions: RevisionRepository
    readonly threadResolutions: ThreadResolutionRepository
  },
  retroId: number,
  threads: readonly CommentThread[],
): Promise<readonly ThreadView[]> {
  const [revisions, resolutions] = await Promise.all([
    repositories.revisions.listByRetro(retroId),
    repositories.threadResolutions.listLatestForThreads(threads.map((thread) => thread.id)),
  ])
  return buildThreadViews(threads, revisions, resolutions)
}
