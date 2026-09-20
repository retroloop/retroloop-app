import { z } from 'zod'
import { parseOrThrow } from '#application/schemas/parse'
import { nonEmptyTextSchema } from '#application/schemas/text.schema'

/**
 * What a relation write says. **Every relation carries how-they-relate words**,
 * and that is a rule of the shape rather than a convention.
 *
 * **`related` is required and has no default**, for the reason `status` and
 * `state` are on their inputs: nothing in this product is inferred from silence.
 * There is no shape of this input that takes two records apart without saying
 * so.
 *
 * **`how` and `related` constrain each other**, and the pairing is validated as
 * a union so each half is the schema's answer rather than half the schema's and
 * half the use case's — the standing `recordLifecycleInputSchema` set with
 * `refs`:
 *
 * - relating carries **words**, non-empty. That is the point of the feature, and
 *   a relation citing nothing is the bare link this feature exists instead of.
 * - un-relating carries **none**, and they are refused rather than dropped. A
 *   dropped field is a caller who thinks they said something they did not — and
 *   there is nothing a second account of the relation could be *about*: the act
 *   is "this relation, off", and the row it writes carries forward the words of
 *   the relation it takes off (`relate-records.use-case.ts`).
 *
 * What this schema deliberately does **not** decide is which records exist,
 * whether they are the same record, and whether the pair already stands. An
 * input shape cannot see the store, and all three live in the use case.
 */
export const recordRelationInputSchema = z.union([
  z.strictObject({
    related: z.literal(true),
    how: nonEmptyTextSchema,
  }),
  z.strictObject({
    related: z.literal(false),
    how: z
      .string()
      .max(
        0,
        'un-relating two records takes no words; the row carries forward the words of the relation it takes off',
      )
      .optional(),
  }),
])

export type RecordRelationInput = z.infer<typeof recordRelationInputSchema>

export function parseRecordRelationInput(input: unknown): RecordRelationInput {
  return parseOrThrow(recordRelationInputSchema, input, 'relation')
}
