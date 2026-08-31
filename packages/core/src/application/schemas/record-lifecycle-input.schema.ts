import { z } from 'zod'
import { parseOrThrow } from '#application/schemas/parse'
import { optionalTextSchema } from '#application/schemas/text.schema'
import { RECORD_LIFECYCLE_STATUSES } from '#domain/models/record-lifecycle.model'

export const recordLifecycleStatusSchema = z.literal([...RECORD_LIFECYCLE_STATUSES])

/**
 * One reference an entry cites — a commit sha, a PR or issue URL, a branch, a
 * ticket number.
 *
 * **Trimmed here, and this is the one field in the system that is.** Free text
 * everywhere else travels verbatim (`text.schema.ts`), because a note is prose
 * and a stray space is the author's. A reference is a token: it gets copied out
 * of a terminal or a browser bar, it arrives with whitespace attached more often
 * than not, and `" abc123"` and `"abc123"` are the same commit — two rows saying
 * so differently would be two references on the page.
 */
const refSchema = z
  .string()
  .transform((ref) => ref.trim())
  .refine((ref) => ref.length > 0, 'a reference must not be empty')

/**
 * An act that cites nothing: a reopen, an archive, an unarchive.
 *
 * References are refused rather than dropped, because a dropped field is a
 * caller who thinks they said something they did not — and because the reader
 * treats refs as present exactly when the record is resolved. Refs on an open
 * record would be refs to the fix that did **not** hold, shown as if they were
 * the fix that did; refs on an archived one would be evidence for a claim
 * nobody made.
 *
 * The message names the act, so a caller reads what it did wrong rather than
 * what some other act may not do.
 */
function citesNothing<T extends string>(status: T, doing: string) {
  return z.strictObject({
    status: z.literal(status),
    refs: z
      .array(refSchema)
      .max(0, `${doing} a record takes no references; they belong to the resolve`)
      .optional(),
    note: optionalTextSchema,
  })
}

/**
 * What a lifecycle write says (the owner's session-8 ask, widened by his
 * session-9 one).
 *
 * `status` is required and has no default, for the reason `decisionInputSchema`
 * gives about `state`: nothing in this product is inferred from silence
 * (KC-0010). There is no shape of this input that resolves a record without
 * saying "resolved".
 *
 * **`refs` and `status` constrain each other**, and the rule is enforced here
 * rather than left to the caller:
 *
 * - a `resolved` entry carries **at least one** reference. That is the whole
 *   point of the ask — *"we should be able to specify a commit id or github
 *   issue or something as reference so that it is easy to see"* — and a resolve
 *   citing nothing is the claim without the evidence.
 * - every other act carries **none**, for the reasons above `citesNothing`.
 *
 * The pairing is validated as a union so that each half is the schema's answer
 * rather than one being the schema's and the rest the use case's. What this
 * schema deliberately does **not** decide is *who* may take each act and *from
 * where* — an input shape cannot see the actor's authority or the record's
 * current state, and both of those live in the use case
 * (`set-record-lifecycle.use-case.ts`).
 *
 * A `note` is offered on all four, and demanded on none: the standing
 * `holds.note` posture, and the same one the resolve composer has.
 */
export const recordLifecycleInputSchema = z.union([
  z.strictObject({
    status: z.literal('resolved'),
    refs: z.array(refSchema).min(1, 'resolving a record needs at least one reference'),
    note: optionalTextSchema,
  }),
  citesNothing('reopened', 'reopening'),
  citesNothing('archived', 'archiving'),
  citesNothing('unarchived', 'unarchiving'),
])

export type RecordLifecycleInput = z.infer<typeof recordLifecycleInputSchema>

export function parseRecordLifecycleInput(input: unknown): RecordLifecycleInput {
  return parseOrThrow(recordLifecycleInputSchema, input, 'lifecycle')
}
