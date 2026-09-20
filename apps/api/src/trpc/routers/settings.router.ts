import { z } from 'zod'
import { procedure, router } from '#trpc/trpc'
import { settingsSchema } from '#trpc/views.schema'

/**
 * The global settings — one key today, and it carries a standing guarantee: the
 * config page has a toggle the user can enable to give the AI the ability to
 * update the configs. Otherwise, while it is disabled, the user can be certain
 * that the AI cannot mess around.
 *
 * **This router renders the switch; it does not enforce it.** The enforcement is
 * `assertAiMayWriteDefinitions`, read in core inside the unit of work that would
 * do the writing, because the guarantee has to hold against a bypassed UI, a
 * hand-rolled call, and the AI's own process against the same SQLite file.
 * Everything here would be true of a page that lied.
 *
 * `setAiConfigWrite` is human-only in the domain **forever**, whatever the
 * switch currently says. This transport can never be refused by that rule — the
 * context's actor is `human` unconditionally — which is precisely why the rule
 * is in the use case: there is no CLI command for it either, and neither
 * absence is what enforces it.
 */
export const settingsRouter = router({
  /**
   * Open to both actors in the domain, and this transport is the human's. The
   * AI reads the same answer through the CLI: reading a permission is not
   * exercising it, and an agent that can see the switch is off can say so rather
   * than only bumping into a refusal.
   */
  get: procedure
    .input(z.strictObject({}))
    .output(settingsSchema)
    .query(async ({ ctx }) => {
      const { aiConfigWrite } = await ctx.app.settings.get.execute({ actor: ctx.actor })
      return { aiConfigWrite }
    }),

  /**
   * **The one procedure whose whole job is a promise about another actor.**
   *
   * `enabled` is required and has no default, for the reason `decisions.record`
   * requires a state: nothing in this product is inferred from silence, and a
   * permission that could be granted by an omitted field would be the worst
   * possible place to start.
   *
   * The write appends a version rather than editing one, so the answer to "has
   * it ever been on?" survives every later change — which is what the certainty
   * guarantee asks for about the past as well as the present. The version is not
   * on the wire: nothing on the page renders one.
   */
  setAiConfigWrite: procedure
    .input(z.strictObject({ enabled: z.boolean() }))
    .output(settingsSchema)
    .mutation(async ({ input, ctx }) => {
      const { aiConfigWrite } = await ctx.app.settings.setAiConfigWrite.execute({
        actor: ctx.actor,
        enabled: input.enabled,
      })
      return { aiConfigWrite }
    }),
})
