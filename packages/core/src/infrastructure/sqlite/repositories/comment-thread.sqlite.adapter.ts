import type { Database } from 'bun:sqlite'
import type { Actor } from '#domain/models/actor.model'
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
import { checked, optionalNumber, optionalText } from '#infrastructure/sqlite/rows'

type ThreadRow = {
  id: number
  retro_id: number
  rid: string | null
  section: string | null
  opened_at: string
}

type CommentRow = {
  id: number
  thread_id: number
  actor: string
  text: string
  at: string
  /** NULL on every comment written before `comments_add_revision`, forever. */
  revision_n: number | null
}

const THREAD_COLUMNS = 'id, retro_id, rid, section, opened_at'
const COMMENT_COLUMNS = 'id, thread_id, actor, text, at, revision_n'

function toComment(row: CommentRow): Comment {
  return {
    id: row.id,
    threadId: row.thread_id,
    actor: checked<Actor>(row.actor),
    text: row.text,
    at: row.at,
    revisionN: optionalNumber(row.revision_n),
  }
}

function toThread(row: ThreadRow, messages: readonly Comment[]): CommentThread {
  return {
    id: row.id,
    retroId: row.retro_id,
    rid: optionalText(row.rid),
    section: row.section === null ? undefined : checked<RecordSection>(row.section),
    openedAt: row.opened_at,
    messages,
  }
}

export class SqliteCommentThreadRepository implements CommentThreadRepository {
  constructor(private readonly db: Database) {}

  async addThread(thread: NewCommentThread): Promise<CommentThread> {
    const { lastInsertRowid } = this.db.run(
      'INSERT INTO comment_threads (retro_id, rid, section, opened_at) VALUES (?, ?, ?, ?)',
      [thread.retroId, thread.rid ?? null, thread.section ?? null, thread.openedAt],
    )
    const stored = await this.findById(Number(lastInsertRowid))
    if (stored === undefined) throw new Error('thread disappeared immediately after insert')
    return stored
  }

  async addComment(threadId: number, comment: NewComment): Promise<CommentThread | undefined> {
    if ((await this.findById(threadId)) === undefined) return undefined

    this.db.run(
      'INSERT INTO comments (thread_id, actor, text, at, revision_n) VALUES (?, ?, ?, ?, ?)',
      [threadId, comment.actor, comment.text, comment.at, comment.revisionN ?? null],
    )
    return this.findById(threadId)
  }

  async findById(id: number): Promise<CommentThread | undefined> {
    const row = this.db
      .query<ThreadRow, [number]>(`SELECT ${THREAD_COLUMNS} FROM comment_threads WHERE id = ?`)
      .get(id)
    return row === null ? undefined : toThread(row, this.messagesOf([row.id]).get(row.id) ?? [])
  }

  async findByAnchor(
    retroId: number,
    rid: string,
    section: RecordSection,
  ): Promise<CommentThread | undefined> {
    const row = this.db
      .query<ThreadRow, [number, string, string]>(
        `SELECT ${THREAD_COLUMNS} FROM comment_threads
         WHERE retro_id = ? AND rid = ? AND section = ?`,
      )
      .get(retroId, rid, section)
    return row === null ? undefined : toThread(row, this.messagesOf([row.id]).get(row.id) ?? [])
  }

  async listByRetro(
    retroId: number,
    filter: ThreadListFilter = {},
  ): Promise<readonly CommentThread[]> {
    const rows = this.db
      .query<ThreadRow, [number, string | null, string | null]>(
        `SELECT ${THREAD_COLUMNS} FROM comment_threads
         WHERE retro_id = ? AND (? IS NULL OR rid = ?)
         ORDER BY id ASC`,
      )
      .all(retroId, filter.rid ?? null, filter.rid ?? null)

    const messages = this.messagesOf(rows.map((row) => row.id))
    const threads = rows.map((row) => toThread(row, messages.get(row.id) ?? []))

    // "Unanswered" is a fact about the conversation — the last word is the
    // human's — not a flag anyone sets, so it is read off the messages.
    return filter.unansweredOnly !== true
      ? threads
      : threads.filter((thread) => thread.messages.at(-1)?.actor === 'human')
  }

  /** One query for a page of threads rather than one per thread. */
  private messagesOf(threadIds: readonly number[]): Map<number, Comment[]> {
    const grouped = new Map<number, Comment[]>()
    if (threadIds.length === 0) return grouped

    const placeholders = threadIds.map(() => '?').join(', ')
    const rows = this.db
      .query<CommentRow, number[]>(
        `SELECT ${COMMENT_COLUMNS} FROM comments
         WHERE thread_id IN (${placeholders})
         ORDER BY id ASC`,
      )
      .all(...threadIds)

    for (const row of rows) {
      const comment = toComment(row)
      const existing = grouped.get(comment.threadId)
      if (existing === undefined) grouped.set(comment.threadId, [comment])
      else existing.push(comment)
    }
    return grouped
  }
}
