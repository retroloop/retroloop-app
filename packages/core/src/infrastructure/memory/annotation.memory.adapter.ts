import type { Annotation, NewAnnotation } from '#domain/models/annotation.model'
import type { AnnotationRepository } from '#domain/repositories/annotation.repository'
import { clone, type MemoryDatabase } from '#infrastructure/memory/memory-database'

export class MemoryAnnotationRepository implements AnnotationRepository {
  constructor(private readonly db: MemoryDatabase) {}

  async add(annotation: NewAnnotation): Promise<Annotation> {
    const row: Annotation = { id: this.db.nextId(), ...annotation }
    this.db.tables.annotations.push(row)
    return clone(row)
  }

  async findByNoteId(noteId: number): Promise<Annotation | undefined> {
    return clone(this.db.tables.annotations.find((annotation) => annotation.noteId === noteId))
  }

  async listBySession(sessionId: number): Promise<readonly Annotation[]> {
    return clone(
      this.db.tables.annotations
        .filter((annotation) => annotation.sessionId === sessionId)
        .sort((left, right) => left.id - right.id),
    )
  }
}
