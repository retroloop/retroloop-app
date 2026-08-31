import { z } from 'zod'
import { parseOrThrow } from '#application/schemas/parse'
import { ATTRIBUTE_TYPES, type AttributeType } from '#domain/models/attribute.model'

export const attributeTypeSchema = z.literal([...ATTRIBUTE_TYPES])

/**
 * How long a definition's name may be. Forty characters is the longest thing
 * that still reads as a *label* on a record card at the width the owner reviews
 * on — a tag is a word or a short phrase, and a sentence in a pill is a sentence
 * nobody can read either way.
 *
 * It is the one number in this file that is a UI consequence rather than a
 * domain rule, and it is here rather than in a component because the CLI writes
 * these too: a cap only the settings page enforced would be a cap the AI's
 * transport walks straight past.
 */
const NAME_MAX = 40

/**
 * What a definition may be called.
 *
 * **Trimmed**, on the same reasoning `refSchema` gives one table over
 * (`record-lifecycle-input.schema.ts`): a name is a token somebody types into a
 * field, `" migrated"` and `"migrated"` are the same label, and two rows saying
 * so differently would be two labels on the page. This is the second field in
 * the system that is trimmed, and both are tokens rather than prose.
 *
 * **No newlines**, because a tag is one line by construction and a name
 * containing one renders as a label the reader can only see half of.
 *
 * That is the whole of it. There is no character class, no slug rule and no
 * reserved-word list: the owner asked for *"very fixed types and not … too many
 * configs, so that we don't have to put in a lot of validations"*, and a label
 * called `needs 🍕` is a label he is entitled to. Uniqueness is not here either
 * — it needs to see every other definition, which a field schema cannot
 * (`definition.service.ts`).
 */
export const definitionNameSchema = z
  .string()
  .transform((name) => name.trim())
  .refine((name) => name.length > 0, 'a name must not be empty')
  .refine((name) => name.length <= NAME_MAX, `a name must be at most ${NAME_MAX} characters`)
  .refine((name) => !name.includes('\n'), 'a name must be one line')

/**
 * How long an attribute's value may be. Five hundred is generous for the thing
 * the owner described — *"a GitHub issue id, or something like that"* — and
 * short enough that a value cannot turn a record page into a wall. Prose belongs
 * in a comment, which has no cap because it is prose.
 */
const VALUE_MAX = 500

/**
 * Whether the string names a day that exists — see the `date` rule below for why
 * this is a round trip rather than a `Date.parse` that is not NaN.
 */
function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/**
 * Light validation, per type — and *light* is the ruling rather than a stage
 * this will grow out of:
 *
 * > *"to keep it simple, we can keep attributes to very fixed types and not with
 * > too many configs, so that we don't have to put in a lot of validations."*
 *
 * So each rule below goes exactly as far as the type's name promises and stops.
 * A `number` parses as a number; a `url` names a web address; a `date` is a
 * calendar day in ISO form; `text` is text. Nothing here checks that a URL
 * resolves, that a date is in the past, or that a number is in a range —
 * every one of those would be a config the owner asked us not to grow.
 *
 * The value is stored **verbatim after trimming**, never canonicalised. `007`
 * stays `007`: nothing in the product does arithmetic on one, and rewriting a
 * human field to taste is the one thing this store never does.
 */
const VALUE_RULES: Record<
  AttributeType,
  { readonly ok: (value: string) => boolean; readonly why: string }
> = {
  /**
   * `Number(value)` rather than `parseFloat`: `parseFloat('12abc')` is 12,
   * which would accept a value the type does not describe. The emptiness check
   * is separate because `Number('')` is 0.
   */
  number: {
    ok: (value) => Number.isFinite(Number(value)),
    why: 'must be a number',
  },
  text: { ok: () => true, why: 'must be text' },
  /**
   * The same question the record page already asks of a reference — does it
   * name a web address? — asked with the same test (`record-lifecycle.tsx`
   * §Reference). Keeping the two identical is what makes "a url attribute
   * renders as a link" true by construction rather than by two rules that
   * happen to agree today. `new URL()` was the alternative and accepts
   * `mailto:` and `javascript:`, neither of which is what a reader clicking a
   * link on this page is expecting.
   */
  url: {
    ok: (value) => /^https?:\/\/\S+$/.test(value),
    why: 'must be a URL starting with http:// or https://',
  },
  /**
   * `YYYY-MM-DD`, and a day that exists.
   *
   * **The round trip is the check, and `Date.parse` alone is not** — measured
   * rather than assumed, because the obvious version of this shipped and a
   * test caught it. `Date.parse('2026-02-31')` does **not** return NaN in V8:
   * it rolls the date over and answers `2026-03-03`, so a regex plus a
   * not-NaN check accepts the 31st of February and then means the 3rd of
   * March. (`2026-13-01` and `2026-01-32` *are* NaN, which is what makes the
   * hole easy to miss: two of the three plausible bad inputs behave.)
   *
   * So the value is parsed and written back out, and the check is that the
   * store would keep the day the writer typed. `Date` parses a date-only ISO
   * string as UTC, which is what makes `toISOString()` round-trip exactly
   * rather than shifting by a timezone.
   */
  date: {
    ok: isCalendarDay,
    why: 'must be an ISO date, YYYY-MM-DD',
  },
}

/**
 * The value schema for one attribute type. Built per type rather than as one
 * schema with a branch, so the message a caller gets names the type it failed —
 * *"must be an ISO date, YYYY-MM-DD"* is actionable and "invalid value" is not.
 */
export function attributeValueSchema(type: AttributeType) {
  const rule = VALUE_RULES[type]
  return z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, 'a value must not be empty')
    .refine((value) => value.length <= VALUE_MAX, `a value must be at most ${VALUE_MAX} characters`)
    .refine(rule.ok, `a ${type} value ${rule.why}`)
}

export function parseDefinitionName(name: unknown): string {
  return parseOrThrow(definitionNameSchema, name, 'name')
}

export function parseAttributeValue(type: AttributeType, value: unknown): string {
  return parseOrThrow(attributeValueSchema(type), value, 'value')
}
