/**
 * An attribute definition — a name and a type, and per-record values against it.
 *
 * Why both primitives exist: beside labels, a user can create attributes and
 * then assign values to those attributes. One team uses GitHub and another
 * something else, so they create an attribute that says 'Jira ticket', or maybe
 * just 'external ticket ID', declare that it always holds a number, and can
 * then query on it.
 *
 * That is the whole of the case for a type: **queryability**. A label answers
 * "which of these are migrated"; an attribute answers "where did this one go",
 * in a shape a reader does not have to grep prose for. The two are pure and
 * independent — labels classify, attributes carry data — and nothing in this
 * system couples them.
 *
 * And how much type there should be: to keep it simple, attributes stay on very
 * fixed types and carry no configuration to speak of, so that little validation
 * has to be written at all.
 *
 * So: four types, no per-attribute configuration at all, and validation that
 * goes exactly as far as the type's name promises and no further
 * (`definition-input.schema.ts`).
 */
export const ATTRIBUTE_TYPES = ['number', 'text', 'url', 'date'] as const

/**
 * What a value of this attribute has to look like. Four, deliberately, and the
 * set is closed by the very-fixed-types rule rather than open for a fifth to be
 * added on a hunch.
 *
 * Every value is **stored as text**, whatever the type — SQLite has no date and
 * no separate number-or-text column, and a `number` attribute holding `'42'` is
 * the same fact as one holding `42`. The type says what the store will accept
 * and what a reader may assume; it does not say what the column is.
 */
export type AttributeType = (typeof ATTRIBUTE_TYPES)[number]

export type AttributeDefinition = {
  readonly id: number
  /** Trimmed as typed; unique ignoring case, the same rule a label's name obeys. */
  readonly name: string
  /**
   * Fixed at creation and **never changed afterwards**, which is the one
   * asymmetry between renaming and retyping.
   *
   * A rename is cosmetic: the values already set stay exactly as true as they
   * were, because nothing about them referred to the old name. A retype is not:
   * every value already stored was accepted under the old type, so changing it
   * would either invalidate history the product refuses to rewrite, or leave the
   * definition claiming a type its own values do not satisfy. Neither is a state
   * worth being able to reach for the sake of a control nobody asked for — the
   * way to change a type is to retire the attribute and define the one you meant,
   * which keeps both readings honest.
   */
  readonly type: AttributeType
  /**
   * When it was retired, or `undefined` while it is still offerable — the same
   * shape and the same doctrine a label's has (`label.model.ts`). A record that
   * already carries a value for a retired attribute goes on showing it.
   */
  readonly retiredAt: string | undefined
  readonly createdAt: string
}

export type NewAttributeDefinition = Omit<AttributeDefinition, 'id'>
