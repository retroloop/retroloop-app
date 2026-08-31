import type {
  CommentThread,
  NewComment,
  NewCommentThread,
} from '#domain/models/comment-thread.model'
import type { RecordSection } from '#domain/models/record.model'

export type ThreadListFilter = {
  /** Record-level threads of one record only. */
  readonly rid?: string
  /** Only threads whose last message is human — "the AI still owes an answer". */
  readonly unansweredOnly?: boolean
}

/**
 * Threads and their messages are append-only. `addComment` is the only mutation,
 * and it appends; nothing here edits or removes a message.
 */
export type CommentThreadRepository = {
  addThread(thread: NewCommentThread): Promise<CommentThread>
  /** Returns `undefined` if the thread is gone. */
  addComment(threadId: number, comment: NewComment): Promise<CommentThread | undefined>
  findById(id: number): Promise<CommentThread | undefined>
  /** The single thread anchored to one section of one record, if it exists. */
  findByAnchor(
    retroId: number,
    rid: string,
    section: RecordSection,
  ): Promise<CommentThread | undefined>
  /** Oldest first. */
  listByRetro(retroId: number, filter?: ThreadListFilter): Promise<readonly CommentThread[]>
}
