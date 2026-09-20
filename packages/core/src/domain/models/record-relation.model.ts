import type { Actor } from '#domain/models/actor.model'

/**
 * One record related to another, in the words of whoever related them. Both
 * actors can relate records, each relation carries how-they-relate words, and
 * the relation reads from both sides, so that the AI can easily find past
 * records and build holistic solutions.
 *
 * **Addressed by global id on both sides, which is the only shape available.**
 * Every other per-record table here is keyed `(retroId, rid)`, because that pair
 * is what identifies a record (`record.model.ts`). A relation identifies two, and
 * a four-column key made of two pairs is a key nobody can read or say. The global
 * id exists for exactly this — *"nobody says a pair out loud"*
 * (`record-id.model.ts`) — it is minted once and never moves, and it is what a
 * reader and the AI cite to each other. It also costs a cross-retrospective
 * relation nothing, which it must, because *"find past records"* is the feature
 * and past records are in past retrospectives.
 *
 * **`how` is required, not offered.** Each relation carries how-they-relate
 * words, and the words are half the act. A relation with none is the bare link
 * this feature exists instead of, leaving a reader to guess whether the second
 * record supersedes the first, duplicates it or caused it. Free text with no
 * vocabulary, on `record_lifecycle.refs`' argument: there are several kinds
 * of relation, and a shape that insisted on knowing which of those it was would
 * be a shape that refuses the fourth kind. A vocabulary of relation words would
 * be a settings-page feature, and labels are already that feature.
 *
 * **Both actors write it**, which it shares with `record_lifecycle` and nothing
 * else — either actor may relate two records — and that is why there is an
 * `actor` column here. Every other append-only table in this store is
 * single-writer, so its author is implied by the table. Append-only applies to
 * both authors all the same: the guarantee is about immutability, which is not
 * a property of who writes.
 *
 * **Directed as authored, read from both sides.** One row per relation as
 * somebody entered it — never a mirror row. Reading from both sides is a
 * property of the read (`listForRecord` asks about both columns and hands the
 * caller the direction), and a reversed second row would be a second thing to
 * keep in agreement, a second thing to un-relate, and a second version sequence
 * to number.
 *
 * **A relation the other way round is a different row and is allowed.** `(#5,
 * #12)` and `(#12, #5)` are two ordered pairs with two version sequences, because
 * they are two statements: "#5 supersedes #12" and "#12 was found first by #5"
 * are not the same sentence, and refusing the second would be this table deciding
 * that a relation is symmetric when the words on it are what say whether it is.
 */
export type RecordRelationEntry = {
  readonly id: number
  /** The global id of the record the relation was authored **from**. */
  readonly fromId: number
  /** The global id of the record it was authored **to**. Never equal to `fromId`. */
  readonly toId: number
  /** 1-based, dense per **ordered pair** `(fromId, toId)`. The highest version is the one in force. */
  readonly version: number
  /**
   * `true` relates the pair, `false` takes the relation off. **Un-relating is a
   * row, never a delete** — the rule every human field in this store obeys, so
   * "related on the 4th, un-related on the 9th" stays readable forever.
   *
   * A 0/1 column rather than a status word, and this is the choice
   * `record_labels` and `record_lifecycle` made opposite ways
   * (`20260901090300:16-21`). The bit is right here for the labels' own reason:
   * relating and un-relating are on and off, and there is no third position a
   * relation could occupy. A relation that means something else is different
   * *words* — which is `how` — or a different pair, which is a different row.
   * The lifecycle enum earned its width because a record's standing turned out
   * to be a scale, and grew from two positions to four in short order;
   * nothing here is a scale.
   */
  readonly applied: boolean
  /**
   * How the two relate, in the author's words — required on every row, the
   * un-relate rows included.
   *
   * An un-relate row carries the words of the relation it takes off, copied
   * forward by the use case rather than asked of the caller
   * (`relate-records.use-case.ts`). A caller free to supply its own words on the
   * way out could leave the history holding two disagreeing accounts of one
   * relation, and there is nothing a second account could be *about*: the act is
   * "this relation, off".
   */
  readonly how: string
  readonly actor: Actor
  readonly at: string
}

export type NewRecordRelationEntry = Omit<RecordRelationEntry, 'id'>
