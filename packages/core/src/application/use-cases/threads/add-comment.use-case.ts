import { type Clock, timestamp } from '#application/ports/clock.port'
import type { Repositories, Store } from '#application/ports/store.port'
import { recordSectionSchema } from '#application/schemas/enums.schema'
import { parseOrThrow } from '#application/schemas/parse'
import { nonEmptyTextSchema } from '#application/schemas/text.schema'
import { loadThreadViews, type ThreadView } from '#application/views/thread.view'
import { ConflictError } from '#domain/errors/conflict.error'
import { NotFoundError } from '#domain/errors/not-found.error'
import { ValidationError } from '#domain/errors/validation.error'
import { newDomainEvent } from '#domain/events/domain-event.model'
import type { Actor } from '#domain/models/actor.model'
import type { CommentThread } from '#domain/models/comment-thread.model'
import type { RecordSection } from '#domain/models/record.model'
import type { Retrospective } from '#domain/models/retrospective.model'
import type { Revision } from '#domain/models/revision.model'
import { refuseWhenFinished } from '#domain/services/finish-lock.service'
import {
  describeRetroRef,
  type RetroRef,
  resolveRetrospective,
  resolveRevision,
} from '#domain/services/reference.service'

/**
 * Where a comment goes:
 * - `record` — the thread on one section of one record, created on first use.
 *   This is what the review page's per-section comment box and the CLI's
 *   `comment add --record --section` both address.
 * - `thread` — an existing thread by id; how the AI answers a review-level thread
 *   the human opened, and how either actor replies to any thread.
 * - `review` — opens a new review-level thread, anchored to nothing.
 */
export type CommentTarget =
  | { readonly kind: 'record'; readonly rid: string; readonly section: RecordSection }
  | { readonly kind: 'thread'; readonly threadId: number }
  | { readonly kind: 'review' }

export type AddCommentInput = {
  /** Both actors comment; the CLI writes `ai` replies, the UI writes `human` ones. */
  readonly actor: Actor
  /**
   * Required to open a thread; optional when replying to one.
   *
   * A thread id already determines its retrospective, so demanding both would
   * make the caller repeat something the store knows — and give it a way to be
   * wrong. When it is supplied anyway it is still checked, which is what catches
   * a reply aimed at the wrong review.
   */
  readonly retro?: RetroRef
  readonly target: CommentTarget
  readonly text: string
  /**
   * The revision the writer had in front of them, stored on the message.
   *
   * The browser sends it, because it knows: a new revision is announced and
   * never swapped in (KC-0005), so the reader may be pinned to revision 1 while
   * revision 2 exists, and the comment belongs to what they were reading. The
   * CLI does not send one and does not need to — the AI comments on the draft it
   * just filed — so an absent value resolves to the latest revision here, in the
   * same unit of work as the write.
   */
  readonly revisionN?: number
}

export type AddCommentOutput = { readonly thread: ThreadView }

/**
 * Messages are append-only and immutable once written, whoever wrote them (D4).
 * Comments on a finished retrospective are refused: `ReviewFinished` is terminal,
 * and an export taken from a finished review must not grow new feedback behind it.
 */
export class AddCommentUseCase {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}

  async execute(input: AddCommentInput): Promise<AddCommentOutput> {
    const text = parseOrThrow(nonEmptyTextSchema, input.text, 'comment.text')

    return this.store.tx(async (repositories) => {
      const retrospective = NotFoundError.require(
        await this.retrospectiveFor(repositories, input),
        'retrospective',
        input.retro === undefined ? 'of the thread' : describeRetroRef(input.retro),
      )
      refuseWhenFinished(retrospective, 'it takes no comments')

      const latest = NotFoundError.require(
        await resolveRevision(repositories.revisions, retrospective.id),
        'revision',
        'latest',
      )
      const revisionN = writtenAgainst(input.revisionN, latest)

      const at = timestamp(this.clock)
      const thread = await this.threadFor(repositories, retrospective.id, input.target, at, latest)

      const updated = NotFoundError.require(
        await repositories.threads.addComment(thread.id, {
          threadId: thread.id,
          actor: input.actor,
          text,
          at,
          revisionN,
        }),
        'thread',
        thread.id,
      )

      await repositories.events.append(
        newDomainEvent(
          'CommentAdded',
          at,
          { retroId: retrospective.id, revisionN, rid: thread.rid },
          { threadId: thread.id, actor: input.actor, section: thread.section ?? null },
        ),
      )

      const [view] = await loadThreadViews(repositories, retrospective.id, [updated])
      return { thread: NotFoundError.require(view, 'thread', thread.id) }
    })
  }

  /**
   * The retrospective this comment belongs to: the one named, or — when replying
   * to a thread without naming one — the thread's own.
   */
  private async retrospectiveFor(
    repositories: Repositories,
    input: AddCommentInput,
  ): Promise<Retrospective | undefined> {
    if (input.retro !== undefined) return resolveRetrospective(repositories, input.retro)

    if (input.target.kind !== 'thread') {
      throw ValidationError.single(
        'retro',
        'opening a thread needs the retrospective it belongs to',
      )
    }
    const thread = NotFoundError.require(
      await repositories.threads.findById(input.target.threadId),
      'thread',
      input.target.threadId,
    )
    return repositories.retrospectives.findById(thread.retroId)
  }

  private async threadFor(
    repositories: Repositories,
    retroId: number,
    target: CommentTarget,
    at: string,
    latest: Revision,
  ): Promise<CommentThread> {
    if (target.kind === 'thread') {
      const thread = NotFoundError.require(
        await repositories.threads.findById(target.threadId),
        'thread',
        target.threadId,
      )
      if (thread.retroId !== retroId) {
        throw new ConflictError(
          `thread ${thread.id} belongs to retrospective ${thread.retroId}, not ${retroId}`,
        )
      }
      return thread
    }

    if (target.kind === 'review') {
      return repositories.threads.addThread({
        retroId,
        rid: undefined,
        section: undefined,
        openedAt: at,
      })
    }

    const section = parseOrThrow(recordSectionSchema, target.section, 'comment.section')
    // The anchor is the record as the latest draft has it: a thread is keyed on
    // `(retroId, rid, section)` and outlives every redraft, so what is being
    // checked here is that the rid is one this retrospective actually has.
    const record = NotFoundError.require(
      latest.records.find((candidate) => candidate.rid === target.rid),
      'record',
      target.rid,
    )

    return (
      (await repositories.threads.findByAnchor(retroId, record.rid, section)) ??
      (await repositories.threads.addThread({
        retroId,
        rid: record.rid,
        section,
        openedAt: at,
      }))
    )
  }
}

/**
 * The revision the comment is stamped with: the one the caller names, checked,
 * or the latest when they name none.
 *
 * The range is `1 … latest` because those are the revisions that exist. A number
 * above it is a caller inventing a draft nobody has filed, and a number below 1
 * is not a revision at all — both are the caller's mistake, and a stored answer
 * nobody can question is exactly what this column must not become.
 */
function writtenAgainst(revisionN: number | undefined, latest: Revision): number {
  if (revisionN === undefined) return latest.n
  if (!Number.isInteger(revisionN) || revisionN < 1 || revisionN > latest.n) {
    throw ValidationError.single(
      'comment.revisionN',
      `a comment belongs to one of revisions 1…${latest.n}, not ${revisionN}`,
    )
  }
  return revisionN
}
