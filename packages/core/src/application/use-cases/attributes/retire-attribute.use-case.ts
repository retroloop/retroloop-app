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

export type RetireAttributeInput = {
  readonly actor: Actor
  readonly attribute: AttributeRef
}

export type RetireAttributeOutput = { readonly attribute: AttributeDefinition }

/**
 * An attribute stops being offered. Not a delete, for the reasons
 * `RetireLabelUseCase` gives: the values already set go on rendering under the
 * name they were set against, and only the *offering* stops.
 *
 * It is also the answer to the one thing a retype would have been for. An
 * attribute whose type turned out wrong is retired and redefined, which leaves
 * every value that was accepted under the old type readable and true, where a
 * retype would have left the definition claiming something its own values do not
 * satisfy.
 *
 * Retiring twice is refused rather than absorbed, on the standing that answering
 * "done" to an act that did nothing is the quiet inference this product refuses.
 */
export class RetireAttributeUseCase {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}

  async execute(input: RetireAttributeInput): Promise<RetireAttributeOutput> {
    return this.store.tx(async (repositories) => {
      await assertAiMayWriteDefinitions(repositories.settings, input.actor, 'retiring an attribute')

      const attribute = NotFoundError.require(
        await resolveAttribute(repositories.attributeDefinitions, input.attribute),
        'attribute',
        describeAttributeRef(input.attribute),
      )
      if (!isOfferable(attribute)) {
        throw new ConflictError(
          `the attribute "${attribute.name}" was already retired at ${attribute.retiredAt}`,
        )
      }

      const at = timestamp(this.clock)
      const retired = await repositories.attributeDefinitions.retire(attribute.id, at)
      await repositories.events.append(
        newDomainEvent('AttributeRetired', at, {}, { attributeId: retired.id, name: retired.name }),
      )

      return { attribute: retired }
    })
  }
}
