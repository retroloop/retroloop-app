import { retroDisplayState } from '@retro/core'
import { z } from 'zod'
import { procedure, router } from '#trpc/trpc'
import { reviewOutcomeSchema } from '#trpc/views.schema'

/**
 * **One act, and it is the human's** (`r-one-finish-button`). There were
 * two — `finish` and `requestChanges`, one procedure per event name — and the
 * second was removed on sight: two buttons are one too many, because requesting
 * a lot of changes in comments and then pressing finish review is a state the
 * page should not allow. Where the round stands is clear from the content of the
 * comments rather than from a redundant button that can be pressed wrong.
 *
 * So this is what the page can do to a review, whole. `finish` says the human's
 * side of the round is closed; what happens next — the next revision, or the
 * export — is the AI's step, taken through the CLI (`retro review close`) after
 * reading what the human wrote. There is no `close` procedure and there will not
 * be one: the tRPC context is unconditionally `human`, and closing is the AI's
 * act. Nothing here is ever inferred from silence, absence of comments, or time
 * passing.
 *
 * `finish` is the one procedure that can answer `PRECONDITION_FAILED`: the finish
 * gate refuses while any record is still pending, and the pending rids travel in
 * the error's data so the page can point at them instead of just saying no.
 *
 * Pressing it twice in a round is absorbed rather than refused
 * (`r-request-changes-multi-press`): the second call writes nothing and answers
 * exactly what the first one did.
 *
 * The input carries the human's optional final message on the round
 * (`r-finish-confirm-message`). It does not come back in the outcome: the page
 * sent it, the core stored it, and the reader it was written for is the AI on the
 * round read — echoing it to the browser would be a field nothing renders.
 */
export const reviewRouter = router({
  finish: procedure
    .input(z.strictObject({ retroId: z.int(), finishMessage: z.string().optional() }))
    .output(reviewOutcomeSchema)
    .mutation(async ({ input, ctx }) => {
      const { retrospective, revisionN } = await ctx.app.review.finish.execute({
        actor: ctx.actor,
        retro: { retroId: input.retroId },
        finishMessage: input.finishMessage,
      })

      // The retrospective's own state is untouched and still `reviewing`: this
      // closes the human's side of the round, and only `ReviewClosed` finishes a
      // retrospective. What comes back is the *displayed* reading of that same
      // unchanged row — `submitted`, because the round the press just finished
      // is the latest one — so the mutation's answer and the `retros.get` that
      // follows it say the same word about the same retro (`retro.view.ts`).
      return {
        retroId: retrospective.id,
        state: retroDisplayState(retrospective.state, true),
        revision: revisionN,
        finishedAt: retrospective.finishedAt ?? null,
      }
    }),
})
