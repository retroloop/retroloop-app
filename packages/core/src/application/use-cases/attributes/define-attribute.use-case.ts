import { type Clock, timestamp } from '#application/ports/clock.port'
import type { Store } from '#application/ports/store.port'
import { parseDefinitionName } from '#application/schemas/definition-input.schema'
import { ConflictError } from '#domain/errors/conflict.error'
import { newDomainEvent } from '#domain/events/domain-event.model'
import type { Actor } from '#domain/models/actor.model'
import type { AttributeDefinition, AttributeType } from '#domain/models/attribute.model'
import { assertAiMayWriteDefinitions } from '#domain/services/config-write.service'
import { definitionNamed } from '#domain/services/definition.service'

export type DefineAttributeInput = {
  readonly actor: Actor
  readonly name: string
  /**
   * Fixed here and never afterwards. There is no retype anywhere in the system —
   * every value already stored was accepted under the type this row carries, and
   * changing it would leave the definition claiming something its own values do
   * not satisfy (`attribute.model.ts`).
   */
  readonly type: AttributeType
}

export type DefineAttributeOutput = { readonly attribute: AttributeDefinition }

/**
 * An attribute is created — a user can define one called "Jira ticket", or just
 * "external ticket ID", and say that it is always going to be a number.
 *
 * The same two refusals `DefineLabelUseCase` has and for the same reasons: the
 * AI while the toggle is off, and a name another definition already uses. The
 * name check is against **attributes only** — a label called `migrated` and an
 * attribute called `migrated` are two different things a reader will never
 * confuse, because one is worn and the other holds a value, and refusing the
 * pair would be the system enforcing a relationship between two primitives that
 * are independent by design.
 */
export class DefineAttributeUseCase {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}

  async execute(input: DefineAttributeInput): Promise<DefineAttributeOutput> {
    const name = parseDefinitionName(input.name)

    return this.store.tx(async (repositories) => {
      await assertAiMayWriteDefinitions(
        repositories.settings,
        input.actor,
        `creating the attribute "${name}"`,
      )

      const existing = definitionNamed(await repositories.attributeDefinitions.listAll(), name)
      if (existing !== undefined) {
        throw new ConflictError(
          `an attribute called "${existing.name}" already exists${
            existing.retiredAt === undefined
              ? ''
              : ' (retired, and still on the records that carry it)'
          }`,
        )
      }

      const at = timestamp(this.clock)
      const attribute = await repositories.attributeDefinitions.add({
        name,
        type: input.type,
        retiredAt: undefined,
        createdAt: at,
      })

      await repositories.events.append(
        newDomainEvent(
          'AttributeDefined',
          at,
          {},
          { attributeId: attribute.id, name: attribute.name, type: attribute.type },
        ),
      )

      return { attribute }
    })
  }
}
