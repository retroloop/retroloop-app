/**
 * The value a record carries for one attribute, or the act of clearing it.
 *
 * The motivating example is the shape of this table: a user creates an
 * attribute called 'Jira ticket', or maybe just 'external ticket ID', declares
 * that it always holds a number, and can then query on it. A record wearing the
 * `migrated` label and carrying `external ticket ID = 4192` is that pairing —
 * and the pairing is a team's own convention, never something this table knows about.
 *
 * **Human-only, for now**, exactly as applying a label is
 * (`record-label.model.ts`), so this is a human field: the use case refuses the
 * `ai` actor first, the append-only triggers back it up at L1, and the table has
 * no `actor` column because it has one writer.
 *
 * Keyed on `(retroId, rid, attributeId)` — the pair plus the definition, because
 * a rid is minted per retrospective and is not globally unique.
 */
export type RecordAttributeValueEntry = {
  readonly id: number
  readonly retroId: number
  readonly rid: string
  readonly attributeId: number
  /** 1-based, dense per `(retroId, rid, attributeId)`. The highest version stands. */
  readonly version: number
  /**
   * What it was set to, or `undefined` where the act was *clearing* it.
   *
   * **Clearing is a row with no value, not a deleted row**, which is the same
   * distinction every append-only table in this schema draws: a record that once
   * pointed at `github.com/o/r#118` and no longer does is a different fact from
   * a record that never pointed anywhere, and only a row can hold the first one.
   *
   * Always text, whatever the attribute's type says (`attribute.model.ts`).
   * A `number` attribute stores the digits the human typed, trimmed — validated
   * as parseable and stored verbatim rather than canonicalised, because nothing
   * in the product does arithmetic on one and rewriting `007` to `7` would be
   * the system editing a human field to taste.
   */
  readonly value: string | undefined
  readonly at: string
}

export type NewRecordAttributeValueEntry = Omit<RecordAttributeValueEntry, 'id'>
