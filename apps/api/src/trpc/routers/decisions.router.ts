import {
  decisionVerdictSchema,
  involvementSchema,
  ridSchema,
  severitySchema,
  solutionLevelInputSchema,
} from '@retro/core'
import { z } from 'zod'
import { procedure, router } from '#trpc/trpc'
import { decisionResultSchema } from '#trpc/views.schema'
import { toWireDecision } from '#trpc/wire'

/**
 * `decisions.record` — approve or decline (or move back to pending), with the
 * three values and the reviewer's note (D1/D4).
 *
 * **`hold` is not one of them any more** (`r-hold-semantics`). It left
 * the verdict axis to become a lifecycle flag of its own, and
 * `r-remove-hold` removed that too. The output enum still speaks all four,
 * because a record decided `hold` before the split keeps that state: this narrows
 * what can be written, never what can be read — the same cut made to
 * solution level, one field over.
 *
 * **`revision` is required, not defaulted.** A new revision is announced, never
 * swapped in, so the reviewer may still be looking at revision 1 when
 * revision 2 exists — and a verdict has to bind to the content they actually
 * read. Making the page say which revision it was showing is what keeps the
 * carry-over rule honest; defaulting to "latest" here would silently attach the
 * click to a draft nobody had seen.
 *
 * The state has no default either: nothing in this product is decided by
 * omission.
 *
 * `solutionLevel` accepts levels 1–5 and nothing else. The output
 * still speaks the full eight, because a record decided before the cut keeps
 * what it was given: this narrows what can be written, never what can be read.
 *
 * **`solutionLevel` and `selectedSolution` are one input each for one shape of
 * record**, and the pair is not interchangeable: on a record that proposes
 * solutions the level *is* the selected solution's, so sending a level there is
 * refused, and sending a selection for a record that proposes none is refused
 * the other way. Both are `BAD_REQUEST`, raised where the record can be seen
 * (`RecordDecisionUseCase`) rather than here, because this schema cannot know
 * which shape the `rid` points at.
 */
export const decisionsRouter = router({
  record: procedure
    .input(
      z.strictObject({
        retroId: z.int(),
        rid: ridSchema,
        revision: z.int().positive(),
        state: decisionVerdictSchema,
        severity: severitySchema.optional(),
        solutionLevel: solutionLevelInputSchema.optional(),
        /** 1-based into the record's `solutions` — the number on the tab. */
        selectedSolution: z.int().positive().optional(),
        involvement: involvementSchema.optional(),
        reviewerNote: z.string().min(1).optional(),
      }),
    )
    .output(decisionResultSchema)
    .mutation(async ({ input, ctx }) => {
      const { decision, record } = await ctx.app.decisions.record.execute({
        actor: ctx.actor,
        retro: { retroId: input.retroId },
        rid: input.rid,
        revision: input.revision,
        decision: {
          state: input.state,
          severity: input.severity,
          solutionLevel: input.solutionLevel,
          selectedSolution: input.selectedSolution,
          involvement: input.involvement,
          reviewerNote: input.reviewerNote,
        },
      })

      return {
        rid: decision.rid,
        version: decision.version,
        decision: toWireDecision(record.decision),
      }
    }),
})
