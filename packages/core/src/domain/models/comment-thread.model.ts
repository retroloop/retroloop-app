import type { Actor } from '#domain/models/actor.model'
import type { RecordSection } from '#domain/models/record.model'

/** Messages are append-only and immutable, whoever wrote them (D4). */
export type Comment = {
  readonly id: number
  readonly threadId: number
  readonly actor: Actor
  readonly text: string
  readonly at: string
  /**
   * The revision this comment was written against, captured at write time —
   * the owner's *"comment show the rev number they are associated with"*.
   *
   * `undefined` on every comment written before the column existed, and it stays
   * that way: human data is never rewritten, so nothing backfills it. A reader
   * that wants a number for every message derives one instead
   * (`buildThreadView` in `application/views/thread.view.ts`), which is the only
   * place that derivation is written down.
   */
  readonly revisionN: number | undefined
}

export type NewComment = Omit<Comment, 'id'>

/**
 * A thread anchored either to one section of one record, or to the review itself
 * (data-model.md §Comment threads).
 *
 * Record-level threads are keyed by `(retroId, rid, section)` — one thread per
 * section per record, which is both what the review page shows and what the CLI's
 * `comment add --record --section` can address. Review-level threads carry neither
 * `rid` nor `section`; a retrospective may have many of them, so they are opened
 * explicitly and replied to by id.
 */
export type CommentThread = {
  readonly id: number
  readonly retroId: number
  readonly rid: string | undefined
  readonly section: RecordSection | undefined
  readonly openedAt: string
  readonly messages: readonly Comment[]
}

export type NewCommentThread = Omit<CommentThread, 'id' | 'messages'>
