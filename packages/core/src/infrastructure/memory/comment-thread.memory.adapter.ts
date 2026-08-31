import type {
  Comment,
  CommentThread,
  NewComment,
  NewCommentThread,
} from '#domain/models/comment-thread.model'
import type { RecordSection } from '#domain/models/record.model'
import type {
  CommentThreadRepository,
  ThreadListFilter,
} from '#domain/repositories/comment-thread.repository'
import { clone, type MemoryDatabase } from '#infrastructure/memory/memory-database'

export class MemoryCommentThreadRepository implements CommentThreadRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async addThread(thread: NewCommentThread): Promise<CommentThread> {
    const row: CommentThread = { id: this.db.nextId(), ...thread, messages: [] }
    this.db.tables.threads.push(row)
    return clone(row)
  }

  async addComment(threadId: number, comment: NewComment): Promise<CommentThread | undefined> {
    const index = this.db.tables.threads.findIndex((thread) => thread.id === threadId)
    const current = this.db.tables.threads[index]
    if (current === undefined) return undefined

    const message: Comment = { id: this.db.nextId(), ...comment, threadId }
    const updated: CommentThread = { ...current, messages: [...current.messages, message] }
    this.db.tables.threads[index] = updated
    return clone(updated)
  }

  async findById(id: number): Promise<CommentThread | undefined> {
    return clone(this.db.tables.threads.find((thread) => thread.id === id))
  }

  async findByAnchor(
    retroId: number,
    rid: string,
    section: RecordSection,
  ): Promise<CommentThread | undefined> {
    return clone(
      this.db.tables.threads.find(
        (thread) => thread.retroId === retroId && thread.rid === rid && thread.section === section,
      ),
    )
  }

  async listByRetro(
    retroId: number,
    filter: ThreadListFilter = {},
  ): Promise<readonly CommentThread[]> {
    return clone(
      this.db.tables.threads
        .filter(
          (thread) =>
            thread.retroId === retroId &&
            (filter.rid === undefined || thread.rid === filter.rid) &&
            (filter.unansweredOnly !== true || thread.messages.at(-1)?.actor === 'human'),
        )
        .sort((left, right) => left.id - right.id),
    )
  }
}
