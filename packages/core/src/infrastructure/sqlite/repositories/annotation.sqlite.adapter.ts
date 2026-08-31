import type { Database } from 'bun:sqlite'
import type { Annotation, NewAnnotation } from '#domain/models/annotation.model'
import type { AnnotationRepository } from '#domain/repositories/annotation.repository'

type AnnotationRow = {
  id: number
  note_id: number
  session_id: number
  text: string
  at: string
}

const COLUMNS = 'id, note_id, session_id, text, at'

function toAnnotation(row: AnnotationRow): Annotation {
  return {
    id: row.id,
    noteId: row.note_id,
    sessionId: row.session_id,
    text: row.text,
    at: row.at,
  }
}

export class SqliteAnnotationRepository implements AnnotationRepository {
  constructor(private readonly db: Database) {}

  async add(annotation: NewAnnotation): Promise<Annotation> {
    const { lastInsertRowid } = this.db.run(
      'INSERT INTO annotations (note_id, session_id, text, at) VALUES (?, ?, ?, ?)',
      [annotation.noteId, annotation.sessionId, annotation.text, annotation.at],
    )
    const row = this.db
      .query<AnnotationRow, [number]>(`SELECT ${COLUMNS} FROM annotations WHERE id = ?`)
      .get(Number(lastInsertRowid))
    if (row === null) throw new Error('annotation disappeared immediately after insert')
    return toAnnotation(row)
  }

  async findByNoteId(noteId: number): Promise<Annotation | undefined> {
    const row = this.db
      .query<AnnotationRow, [number]>(`SELECT ${COLUMNS} FROM annotations WHERE note_id = ?`)
      .get(noteId)
    return row === null ? undefined : toAnnotation(row)
  }

  async listBySession(sessionId: number): Promise<readonly Annotation[]> {
    return this.db
      .query<AnnotationRow, [number]>(
        `SELECT ${COLUMNS} FROM annotations WHERE session_id = ? ORDER BY id ASC`,
      )
      .all(sessionId)
      .map(toAnnotation)
  }
}
