import { type Clock, timestamp } from '#application/ports/clock.port'
import type { Store } from '#application/ports/store.port'
import { parseDefinitionName } from '#application/schemas/definition-input.schema'
import { ConflictError } from '#domain/errors/conflict.error'
import { newDomainEvent } from '#domain/events/domain-event.model'
import type { Actor } from '#domain/models/actor.model'
import type { LabelDefinition } from '#domain/models/label.model'
import { assertAiMayWriteDefinitions } from '#domain/services/config-write.service'
import { definitionNamed } from '#domain/services/definition.service'

export type DefineLabelInput = {
  /**
   * Either actor, and the AI's half is what the AI-config-write toggle governs,
   * enforced below at the store boundary rather than at any transport
   * (`config-write.service.ts`).
   */
  readonly actor: Actor
  readonly name: string
}

export type DefineLabelOutput = { readonly label: LabelDefinition }

/**
 * A label is created — the first half of the settings page, and the only way a
 * label ever comes to exist.
 *
 * **Nothing ships one.** To keep the vocabulary flexible, no labels or
 * attributes are hardcoded. There is no seed, no migration insert and no
 * default, so a store with labels in it is a store somebody typed them into —
 * `migrated` included, which is an example rather than a value the product
 * knows about.
 *
 * Two refusals, and they are different kinds of thing:
 *
 * - **The AI, while the toggle is off** — `assertAiMayWriteDefinitions`, the
 *   first act inside the transaction, so the answer cannot be stale by the time
 *   the write happens and no transport can route around it. FORBIDDEN on the
 *   wire, exit 5 on the CLI.
 * - **A name already in use** — a `ConflictError`, because the store is in a
 *   state this act cannot be applied to. Case-insensitive and **including
 *   retired names**: a retired label is still rendering on every record that
 *   wears it, so a second label reusing the word would make two classifications
 *   read as one thing on the same page (`definition.service.ts`).
 */
export class DefineLabelUseCase {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}

  async execute(input: DefineLabelInput): Promise<DefineLabelOutput> {
    const name = parseDefinitionName(input.name)

    return this.store.tx(async (repositories) => {
      await assertAiMayWriteDefinitions(
        repositories.settings,
        input.actor,
        `creating the label "${name}"`,
      )

      const existing = definitionNamed(await repositories.labelDefinitions.listAll(), name)
      if (existing !== undefined) {
        throw new ConflictError(
          `a label called "${existing.name}" already exists${
            existing.retiredAt === undefined
              ? ''
              : ' (retired, and still on the records that wear it)'
          }`,
        )
      }

      const at = timestamp(this.clock)
      const label = await repositories.labelDefinitions.add({
        name,
        retiredAt: undefined,
        createdAt: at,
      })

      // No retro scope: a definition is global, which is the whole reason the
      // settings page exists. The event still rides in the same unit of work as
      // the write, so the outbox goes on meaning what it means — nothing
      // subscribes to it, because `events.onRetro` is per-retrospective and this
      // belongs to none of them.
      await repositories.events.append(
        newDomainEvent('LabelDefined', at, {}, { labelId: label.id, name: label.name }),
      )

      return { label }
    })
  }
}
