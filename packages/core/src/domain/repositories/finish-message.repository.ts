import type { FinishMessage, NewFinishMessage } from '#domain/models/finish-message.model'

/**
 * Human-authored and append-only, exactly like decisions, holds and thread
 * resolutions: `add` writes a new version and there is no update or delete on
 * this type. The table's own triggers reject `UPDATE`/`DELETE` as the L1
 * backstop.
 *
 * Two reads, because the product asks in two shapes: one round, for the
 * drafting step reading the feedback on the revision it is about to answer, and
 * every round of a retrospective, for the export — the message is carried
 * *per revision round*, so a document that folded them into one would be
 * answering a different question. There is no `listVersionsFor`: nothing shows
 * the history of a message, and a method nothing calls is a method every
 * adapter implements twice.
 */
export type FinishMessageRepository = {
  add(message: NewFinishMessage): Promise<FinishMessage>
  /** The version in force for that round, or `undefined` if no word was left. */
  findLatest(retroId: number, revisionN: number): Promise<FinishMessage | undefined>
  /** The version in force for each round of the retrospective that has one; ascending by revision. */
  listLatestByRetro(retroId: number): Promise<readonly FinishMessage[]>
}
