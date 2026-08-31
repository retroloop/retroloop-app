import { type Clock, timestamp } from '#application/ports/clock.port'
import type { Store } from '#application/ports/store.port'
import { parseDefinitionName } from '#application/schemas/definition-input.schema'
import { ConflictError } from '#domain/errors/conflict.error'
import { NotFoundError } from '#domain/errors/not-found.error'
import { newDomainEvent } from '#domain/events/domain-event.model'
import type { Actor } from '#domain/models/actor.model'
import type { AttributeDefinition } from '#domain/models/attribute.model'
import { assertAiMayWriteDefinitions } from '#domain/services/config-write.service'
import {
  type AttributeRef,
  definitionNamed,
  describeAttributeRef,
  resolveAttribute,
} from '#domain/services/definition.service'

export type RenameAttributeInput = {
  readonly actor: Actor
  readonly attribute: AttributeRef
  readonly name: string
}

export type RenameAttributeOutput = { readonly attribute: AttributeDefinition }

/**
 * An attribute is renamed, and every record carrying a value for it reads the
 * new name — the same write-in-place a label's rename is, for the same reason
 * (`rename-label.use-case.ts`).
 *
 * **A rename is the only shape-changing act an attribute takes.** A retype would
 * be the other one and does not exist: nothing here, nothing on the wire and
 * nothing on the CLI, because every value already stored was accepted under the
 * old type. Retiring the attribute and defining the one you meant is the whole
 * of the alternative, and it keeps both readings honest.
 */
export class RenameAttributeUseCase {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}

  async execute(input: RenameAttributeInput): Promise<RenameAttributeOutput> {
    const name = parseDefinitionName(input.name)

    return this.store.tx(async (repositories) => {
      await assertAiMayWriteDefinitions(
        repositories.settings,
        input.actor,
        `renaming an attribute to "${name}"`,
      )

      const attribute = NotFoundError.require(
        await resolveAttribute(repositories.attributeDefinitions, input.attribute),
        'attribute',
        describeAttributeRef(input.attribute),
      )

      const clash = definitionNamed(
        await repositories.attributeDefinitions.listAll(),
        name,
        attribute.id,
      )
      if (clash !== undefined) {
        throw new ConflictError(`an attribute called "${clash.name}" already exists`)
      }

      const renamed = await repositories.attributeDefinitions.rename(attribute.id, name)
      await repositories.events.append(
        newDomainEvent(
          'AttributeRenamed',
          timestamp(this.clock),
          {},
          { attributeId: renamed.id, from: attribute.name, to: renamed.name },
        ),
      )

      return { attribute: renamed }
    })
  }
}
