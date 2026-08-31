import { attributeTypeSchema, ridSchema } from '@retro/core'
import { z } from 'zod'
import { procedure, router } from '#trpc/trpc'
import { attributeDefinitionSchema, recordAttributesResultSchema } from '#trpc/views.schema'
import { toWireAttributeDefinition, toWireRecordAttribute } from '#trpc/wire'

/**
 * The attribute vocabulary and the values records carry from it — the label
 * router's twin, shape for shape (`labels.router.ts` carries the argument for
 * why the definitions and the record write sit together and what the actor
 * story is).
 *
 * **A second namespace rather than a shared `definitions` one**, and that is the
 * owner's ruling made structural: labels and attributes are pure and
 * independent, and *"composition is the USER'S convention … never a system
 * mechanism"*. A single namespace would be the first place a reader looked for
 * the pairing the system does not have.
 *
 * Two differences from the label side, both of them the type:
 *
 * - `define` takes one, and it is fixed from then on. **There is no `retype`**,
 *   here or anywhere: every value already stored was accepted under the old
 *   type, and this store never rewrites what somebody wrote. Retiring the
 *   attribute and defining the one you meant is the whole alternative.
 * - `set` validates against it, lightly — a number parses, a URL names a web
 *   address, a date is a calendar day. The owner asked for exactly that much:
 *   *"very fixed types and not … too many configs, so that we don't have to put
 *   in a lot of validations."*
 */
export const attributesRouter = router({
  /** The whole vocabulary, retired entries included, in minting order. */
  list: procedure
    .input(z.strictObject({}))
    .output(z.array(attributeDefinitionSchema))
    .query(async ({ ctx }) => {
      const { attributes } = await ctx.app.attributes.list.execute({ actor: ctx.actor })
      return attributes.map(toWireAttributeDefinition)
    }),

  define: procedure
    .input(z.strictObject({ name: z.string(), type: attributeTypeSchema }))
    .output(attributeDefinitionSchema)
    .mutation(async ({ input, ctx }) => {
      const { attribute } = await ctx.app.attributes.define.execute({
        actor: ctx.actor,
        name: input.name,
        type: input.type,
      })
      return toWireAttributeDefinition(attribute)
    }),

  /** The name changes and the type does not — there is no input here that could. */
  rename: procedure
    .input(z.strictObject({ id: z.int().positive(), name: z.string() }))
    .output(attributeDefinitionSchema)
    .mutation(async ({ input, ctx }) => {
      const { attribute } = await ctx.app.attributes.rename.execute({
        actor: ctx.actor,
        attribute: { attributeId: input.id },
        name: input.name,
      })
      return toWireAttributeDefinition(attribute)
    }),

  retire: procedure
    .input(z.strictObject({ id: z.int().positive() }))
    .output(attributeDefinitionSchema)
    .mutation(async ({ input, ctx }) => {
      const { attribute } = await ctx.app.attributes.retire.execute({
        actor: ctx.actor,
        attribute: { attributeId: input.id },
      })
      return toWireAttributeDefinition(attribute)
    }),

  /** Retire's inverse, the label router's twin — and the type is untouched. */
  unretire: procedure
    .input(z.strictObject({ id: z.int().positive() }))
    .output(attributeDefinitionSchema)
    .mutation(async ({ input, ctx }) => {
      const { attribute } = await ctx.app.attributes.unretire.execute({
        actor: ctx.actor,
        attribute: { attributeId: input.id },
      })
      return toWireAttributeDefinition(attribute)
    }),

  /**
   * The human sets a value on a record, or clears it.
   *
   * **`value` absent is the clear**, which is the one place in this whole wire
   * where an absent field means something rather than nothing. It is not
   * silence: the caller is saying "take it off", and the row it writes says the
   * record no longer carries a value — a different fact from never having
   * carried one, and one only a row can hold.
   *
   * `value` is `z.string()` and the type's own rule is the domain's, applied
   * after the definition is resolved because which rule applies is a fact about
   * the row. Restating the four rules here would be a second copy free to
   * disagree with the CLI's.
   *
   * Reachable on a finished retrospective, like its label twin and for the same
   * reason.
   */
  set: procedure
    .input(
      z.strictObject({
        retroId: z.int(),
        rid: ridSchema,
        attributeId: z.int().positive(),
        value: z.string().optional(),
      }),
    )
    .output(recordAttributesResultSchema)
    .mutation(async ({ input, ctx }) => {
      const result = await ctx.app.attributes.set.execute({
        actor: ctx.actor,
        retro: { retroId: input.retroId },
        rid: input.rid,
        attribute: { attributeId: input.attributeId },
        // Spread rather than passed as `value: input.value`, because the use
        // case reads **absence** as the clear and an explicit `undefined` under
        // `exactOptionalPropertyTypes` is not the same thing as no key.
        ...(input.value === undefined ? {} : { value: input.value }),
      })

      return {
        retroId: result.retroId,
        rid: result.rid,
        version: result.version,
        values: result.values.map(toWireRecordAttribute),
      }
    }),
})
