import { ridSchema } from '@retro/core'
import { z } from 'zod'
import { procedure, router } from '#trpc/trpc'
import { labelDefinitionSchema, recordLabelsResultSchema } from '#trpc/views.schema'
import { toWireLabelDefinition, toWireRecordLabel } from '#trpc/wire'

/**
 * The label vocabulary and what records wear from it.
 *
 * **Five definition procedures and one write on a record**, and the split is a
 * standing rule rather than an arrangement: the definitions are global — each
 * label or attribute is a global thing — and are what the settings page manages,
 * while `set` is a mark a human puts on one record.
 *
 * **The record write is `set` and not `apply`, and that is tRPC rather than
 * taste.** `createRouterFactory` refuses three keys outright —
 * `["then", "call", "apply"]`, read out of `@trpc/server@11.18.0`'s own
 * `reservedWords`, because a router is a callable-ish object and those three
 * collide with `Function.prototype` and with thenable detection. It fails at
 * **runtime**, not at compile time: `apply` typechecked cleanly across all four
 * packages and every suite that builds a caller threw
 * `Reserved words used in `router({})` call: apply`. The App's own use case is
 * still `labels.apply`, because the App is a plain object, `apply`/`remove` is
 * the domain's verb, and the two events are `RecordLabelApplied` and
 * `RecordLabelRemoved`. The name differs in exactly one place, and this is it.
 * `set` is also what makes the pair symmetric with `attributes.set`, which is
 * the shape a reader of both routers meets.
 *
 * **Nothing here takes an actor.** The context pins `human` unconditionally
 * (`context.ts`), so the browser is always the human and there is nothing to
 * negotiate. Two consequences worth stating, because they pull in opposite
 * directions:
 *
 * - `set` is human-only in the domain and this transport therefore can never be
 *   refused by that rule — which is exactly why the rule lives in the use case
 *   and not here.
 * - the three definition writes are open to **both** actors in the domain, and
 *   the AI's half is gated by the settings toggle. The browser passes that gate
 *   trivially by being the human; the AI reaches the same use cases through the
 *   CLI, in its own process, where the gate actually bites.
 *
 * **`unretire` is the fourth act, and a retrospective asked for it**
 * (`r-retire-burns-a-word`, selected solution 2). Retiring used to be one press
 * with no confirmation and no way back, which made a mis-press a permanently
 * burned word — the store never frees a retired name. Un-retire makes that a
 * two-press round trip, which is the same reversibility rule the rest of this
 * product lives by; a confirm dialog was the alternative and was dropped,
 * because it taxes every legitimate retire forever to guard against the rare
 * slip.
 */
export const labelsRouter = router({
  /**
   * The whole vocabulary, **retired entries included**, in minting order.
   *
   * One read rather than an offerable/retired pair: the settings page shows the
   * retired ones greyed, a record page resolves a name for a label that may
   * since have been retired, and the filter offers a retired label as long as a
   * record still wears it. Filtering is the reader's, over a list it already
   * holds — there are tens of these, not thousands.
   *
   * `z.strictObject({})` rather than no input, the same call `retros.list`
   * makes: an omitted input is a missing one rather than an empty one.
   */
  list: procedure
    .input(z.strictObject({}))
    .output(z.array(labelDefinitionSchema))
    .query(async ({ ctx }) => {
      const { labels } = await ctx.app.labels.list.execute({ actor: ctx.actor })
      return labels.map(toWireLabelDefinition)
    }),

  define: procedure
    .input(z.strictObject({ name: z.string() }))
    .output(labelDefinitionSchema)
    .mutation(async ({ input, ctx }) => {
      const { label } = await ctx.app.labels.define.execute({ actor: ctx.actor, name: input.name })
      return toWireLabelDefinition(label)
    }),

  /**
   * The name is `z.string()` here and the rule is the domain's — trimmed,
   * non-empty, at most forty characters, one line, and unique ignoring case
   * across the whole vocabulary including retired entries. Restating any of that
   * in this file would be a second copy free to disagree with the CLI's, and the
   * use case raises `ValidationError` or `ConflictError` for the middleware to
   * map.
   */
  rename: procedure
    .input(z.strictObject({ id: z.int().positive(), name: z.string() }))
    .output(labelDefinitionSchema)
    .mutation(async ({ input, ctx }) => {
      const { label } = await ctx.app.labels.rename.execute({
        actor: ctx.actor,
        // By id from a browser, which is holding the list it just read — and an
        // id survives a rename, where the name a page was showing may not
        // (`definition.service.ts`).
        label: { labelId: input.id },
        name: input.name,
      })
      return toWireLabelDefinition(label)
    }),

  retire: procedure
    .input(z.strictObject({ id: z.int().positive() }))
    .output(labelDefinitionSchema)
    .mutation(async ({ input, ctx }) => {
      const { label } = await ctx.app.labels.retire.execute({
        actor: ctx.actor,
        label: { labelId: input.id },
      })
      return toWireLabelDefinition(label)
    }),

  /**
   * The same input as `retire` and the same answer shape, because it is the same
   * row coming back — the id the browser holds is the id it always held, and
   * nothing about the definition changed except whether it is offered.
   *
   * Un-retiring what is not retired is a CONFLICT, mirroring the second retire.
   */
  unretire: procedure
    .input(z.strictObject({ id: z.int().positive() }))
    .output(labelDefinitionSchema)
    .mutation(async ({ input, ctx }) => {
      const { label } = await ctx.app.labels.unretire.execute({
        actor: ctx.actor,
        label: { labelId: input.id },
      })
      return toWireLabelDefinition(label)
    }),

  /**
   * The human puts a label on a record, or takes it off — for instance a label
   * that says 'migrated'.
   *
   * **One procedure carrying the direction**, rather than an apply and a remove:
   * both write a version of the same thing, and the two *names* that exist live
   * in the outbox where a consumer needs to tell them apart without unpacking a
   * payload. `threads.resolve` made the same call with the same boolean.
   *
   * **Still reachable on a finished retrospective**, which is the point: the
   * migrate story happens after the close by construction, so this joins
   * `records.setLifecycle` as a write the finish lock deliberately does not
   * guard (`review.test.ts` enumerates the whole set).
   */
  set: procedure
    .input(
      z.strictObject({
        retroId: z.int(),
        rid: ridSchema,
        labelId: z.int().positive(),
        applied: z.boolean(),
      }),
    )
    .output(recordLabelsResultSchema)
    .mutation(async ({ input, ctx }) => {
      const result = await ctx.app.labels.apply.execute({
        actor: ctx.actor,
        retro: { retroId: input.retroId },
        rid: input.rid,
        label: { labelId: input.labelId },
        applied: input.applied,
      })

      return {
        retroId: result.retroId,
        rid: result.rid,
        version: result.version,
        labels: result.labels.map(toWireRecordLabel),
      }
    }),
})
