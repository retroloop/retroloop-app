import type { Annotation, NewAnnotation } from '#domain/models/annotation.model'

/**
 * One-shot per note: `findByNoteId` is what the use case checks before
 * appending, and the adapter keeps at most one annotation per note. Append-only —
 * no update, no delete.
 */
export type AnnotationRepository = {
  add(annotation: NewAnnotation): Promise<Annotation>
  findByNoteId(noteId: number): Promise<Annotation | undefined>
  listBySession(sessionId: number): Promise<readonly Annotation[]>
}
