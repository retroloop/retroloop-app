/**
 * The human's final message on a round, filed with his finish
 * (`r-finish-confirm-message`, owner-approved).
 *
 * The owner: *"it should show a text box where the human can enter their final
 * message before they close so this message is going to be delivered separately
 * from the comments"*. Separately is the whole point — a comment is a thread the
 * AI answers, and this is a verdict-adjacent summary of the round that the AI
 * reads once, on the round read, and never replies to.
 *
 * The grain is the **round**, which is `(retroId, revisionN)`: the human finishes
 * once per revision, and what he says finishing is about the revision he was
 * reading. That is the same key `ReviewFinished` carries, and until this table
 * there was no row anywhere with it.
 *
 * `version` is here because human data is append-only *and* versioned, the way a
 * decision and a resolution are. Exactly one version can exist today: the finish
 * is once per round and a second press writes nothing, so the message rides the
 * press that carried it. What the column buys is that an amendment, if the
 * product ever grows one, is a new row and the word he left first stays readable.
 */
export type FinishMessage = {
  readonly id: number
  readonly retroId: number
  /** The revision whose round this word closes. */
  readonly revisionN: number
  /** 1-based, dense per round. The highest version is the one in force. */
  readonly version: number
  /** Never empty: a row exists only when he actually wrote something. */
  readonly message: string
  readonly at: string
}

export type NewFinishMessage = Omit<FinishMessage, 'id'>
