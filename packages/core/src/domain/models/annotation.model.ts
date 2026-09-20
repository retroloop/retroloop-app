/**
 * The human's one-shot remark on a single AI note. At most one per note, never
 * threaded — there is to be no back-and-forth there — and invisible to the AI
 * until drafting time.
 *
 * `sessionId` is the annotated note's session, carried here so annotations list
 * per session without a join.
 */
export type Annotation = {
  readonly id: number
  readonly noteId: number
  readonly sessionId: number
  readonly text: string
  readonly at: string
}

export type NewAnnotation = Omit<Annotation, 'id'>
