import type { Database } from 'bun:sqlite'
import type { Actor } from '#domain/models/actor.model'
import type { NewNote, Note, NoteKind } from '#domain/models/note.model'
import type { NoteListFilter, NoteRepository } from '#domain/repositories/note.repository'
import { checked } from '#infrastructure/sqlite/rows'

type NoteRow = {
  id: number
  session_id: number
  author: string
  kind: string | null
  text: string
  at: string
}

const COLUMNS = 'id, session_id, author, kind, text, at'

function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    sessionId: row.session_id,
    author: checked<Actor>(row.author),
    kind: row.kind === null ? undefined : checked<NoteKind>(row.kind),
    text: row.text,
    at: row.at,
  }
}

export class SqliteNoteRepository implements NoteRepository {
  constructor(private readonly db: Database) {}

  async add(note: NewNote): Promise<Note> {
    const { lastInsertRowid } = this.db.run(
      'INSERT INTO notes (session_id, author, kind, text, at) VALUES (?, ?, ?, ?, ?)',
      [note.sessionId, note.author, note.kind ?? null, note.text, note.at],
    )
    const stored = await this.findById(Number(lastInsertRowid))
    if (stored === undefined) throw new Error('note disappeared immediately after insert')
    return stored
  }

  async findById(id: number): Promise<Note | undefined> {
    const row = this.db
      .query<NoteRow, [number]>(`SELECT ${COLUMNS} FROM notes WHERE id = ?`)
      .get(id)
    return row === null ? undefined : toNote(row)
  }

  async listBySession(sessionId: number, filter: NoteListFilter = {}): Promise<readonly Note[]> {
    return this.db
      .query<NoteRow, [number, string | null, string | null]>(
        `SELECT ${COLUMNS} FROM notes
         WHERE session_id = ? AND (? IS NULL OR author = ?)
         ORDER BY id ASC`,
      )
      .all(sessionId, filter.author ?? null, filter.author ?? null)
      .map(toNote)
  }
}
