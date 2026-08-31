import { z } from 'zod'
import {
  decisionVerdictSchema,
  involvementSchema,
  severitySchema,
  solutionLevelInputSchema,
} from '#application/schemas/enums.schema'
import { parseOrThrow } from '#application/schemas/parse'
import { optionalTextSchema } from '#application/schemas/text.schema'

/**
 * The human's verdict on one record (data-model.md §Decision).
 *
 * `state` is required and has no default: the whole product turns on nothing ever
 * being inferred from silence (KC-0010), so there is no shape of this input that
 * decides a record without saying so. The three value fields are optional and fall
 * back to the AI's proposals for that record — a reviewer who accepts the proposed
 * severity says so by leaving it alone, which is an explicit act on an explicit
 * value, not an absence.
 *
 * `solutionLevel` takes the **input** enum, 1–5 only (KC-0021). Leaving it out
 * on a record that already holds a legacy level keeps that level, which is the
 * append-only rule doing its job: the human's earlier answer stands until they
 * give a new one, and the new one can only be a level they were offered.
 *
 * `state` takes the **verdict** enum, four values (`r-hold-semantics`,
 * `r-verdict-revise`): pending, approved, declined, revise. `hold` is not among
 * them — it stopped being something a human decides about a record, and a
 * record decided `hold` before the split keeps that state, because a read path
 * never narrows; this input is what stops a new one being written.
 *
 * `selectedSolution` is which of the record's proposals the human picked, and it
 * is the fourth optional value with the same fallback as the other three — the
 * reviewer who accepts what the AI recommended says so by leaving it alone.
 * Which *record* it may be sent for, and which index is in range for that
 * record, are questions this schema cannot see the record to answer;
 * `RecordDecisionUseCase` asks them and raises the same `ValidationError`.
 */
export const decisionInputSchema = z.strictObject({
  state: decisionVerdictSchema,
  severity: severitySchema.optional(),
  solutionLevel: solutionLevelInputSchema.optional(),
  /** 1-based, so it is the number the reviewer read on the tab. */
  selectedSolution: z.int().positive().optional(),
  involvement: involvementSchema.optional(),
  reviewerNote: optionalTextSchema,
})

export type DecisionInput = z.infer<typeof decisionInputSchema>

export function parseDecisionInput(input: unknown): DecisionInput {
  return parseOrThrow(decisionInputSchema, input, 'decision')
}
