import type { NewNote, Note } from '#domain/models/note.model'
import type { NoteListFilter, NoteRepository } from '#domain/repositories/note.repository'
import { clone, type MemoryDatabase } from '#infrastructure/memory/memory-database'

export class MemoryNoteRepository implements NoteRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async add(note: NewNote): Promise<Note> {
    const row: Note = { id: this.db.nextId(), ...note }
    this.db.tables.notes.push(row)
    return clone(row)
  }

  async findById(id: number): Promise<Note | undefined> {
    return clone(this.db.tables.notes.find((note) => note.id === id))
  }

  async listBySession(sessionId: number, filter: NoteListFilter = {}): Promise<readonly Note[]> {
    return clone(
      this.db.tables.notes
        .filter(
          (note) =>
            note.sessionId === sessionId &&
            (filter.author === undefined || note.author === filter.author),
        )
        .sort((left, right) => left.id - right.id),
    )
  }
}
