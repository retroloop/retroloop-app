import { type Clock, timestamp } from '#application/ports/clock.port'
import type { Store } from '#application/ports/store.port'
import { ConflictError } from '#domain/errors/conflict.error'
import { NotFoundError } from '#domain/errors/not-found.error'
import { newDomainEvent } from '#domain/events/domain-event.model'
import type { Actor } from '#domain/models/actor.model'
import type { AttributeDefinition } from '#domain/models/attribute.model'
import { assertAiMayWriteDefinitions } from '#domain/services/config-write.service'
import {
  type AttributeRef,
  describeAttributeRef,
  isOfferable,
  resolveAttribute,
} from '#domain/services/definition.service'

export type UnretireAttributeInput = {
  readonly actor: Actor
  readonly attribute: AttributeRef
}

export type UnretireAttributeOutput = { readonly attribute: AttributeDefinition }

/**
 * A retired attribute is offered again — `UnretireLabelUseCase`'s twin, and it
 * carries the argument for why the act exists at all (retro-11
 * `r-retire-burns-a-word`).
 *
 * **The type is untouched, and that is what makes this safe here.** An attribute
 * comes back offering the same type it always had, so every value stored under
 * it stays as true as it was and every value set after it will be accepted under
 * the same rule — which is exactly why there is still no `retype`
 * (`attribute.model.ts`).
 *
 * Un-retiring what is not retired is refused rather than absorbed, and the AI's
 * half is gated by the settings switch, both for the reasons the label twin
 * gives.
 */
export class UnretireAttributeUseCase {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}

  async execute(input: UnretireAttributeInput): Promise<UnretireAttributeOutput> {
    return this.store.tx(async (repositories) => {
      await assertAiMayWriteDefinitions(
        repositories.settings,
        input.actor,
        'un-retiring an attribute',
      )

      const attribute = NotFoundError.require(
        await resolveAttribute(repositories.attributeDefinitions, input.attribute),
        'attribute',
        describeAttributeRef(input.attribute),
      )
      if (isOfferable(attribute)) {
        throw new ConflictError(`the attribute "${attribute.name}" is not retired`)
      }

      const restored = await repositories.attributeDefinitions.unretire(attribute.id)
      await repositories.events.append(
        newDomainEvent(
          'AttributeUnretired',
          timestamp(this.clock),
          {},
          { attributeId: restored.id, name: restored.name },
        ),
      )

      return { attribute: restored }
    })
  }
}
