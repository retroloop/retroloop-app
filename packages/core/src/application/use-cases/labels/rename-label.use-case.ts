import { type Clock, timestamp } from '#application/ports/clock.port'
import type { Store } from '#application/ports/store.port'
import { parseDefinitionName } from '#application/schemas/definition-input.schema'
import { ConflictError } from '#domain/errors/conflict.error'
import { NotFoundError } from '#domain/errors/not-found.error'
import { newDomainEvent } from '#domain/events/domain-event.model'
import type { Actor } from '#domain/models/actor.model'
import type { LabelDefinition } from '#domain/models/label.model'
import { assertAiMayWriteDefinitions } from '#domain/services/config-write.service'
import {
  definitionNamed,
  describeLabelRef,
  type LabelRef,
  resolveLabel,
} from '#domain/services/definition.service'

export type RenameLabelInput = {
  readonly actor: Actor
  /** By id from the browser, by name from the CLI (`definition.service.ts`). */
  readonly label: LabelRef
  readonly name: string
}

export type RenameLabelOutput = { readonly label: LabelDefinition }

/**
 * A label is renamed — and **every record that wears it now reads the new name**,
 * which is the whole reason a rename is a write over the row rather than a new
 * definition.
 *
 * That is what makes this configuration rather than human data. A record wears
 * *this label*, addressed by id; the name is how the label is spelled, and
 * correcting a spelling is not a second opinion about what somebody said. The
 * alternative — a versioned name, resolved as of the moment a label was applied
 * — would mean the same label reading two ways on two records, which is exactly
 * the confusion labels exist to remove.
 *
 * **A retired label may still be renamed.** It is on records, it is rendering,
 * and a typo in it is as worth fixing as a typo in an offerable one; retiring
 * stops a label being offered, not being read.
 *
 * The new name may not collide with another definition's, case-insensitively and
 * retired ones included — but it may collide with **its own**, so `migrated` →
 * `Migrated` is a case correction rather than a refusal.
 */
export class RenameLabelUseCase {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}

  async execute(input: RenameLabelInput): Promise<RenameLabelOutput> {
    const name = parseDefinitionName(input.name)

    return this.store.tx(async (repositories) => {
      await assertAiMayWriteDefinitions(
        repositories.settings,
        input.actor,
        `renaming a label to "${name}"`,
      )

      const label = NotFoundError.require(
        await resolveLabel(repositories.labelDefinitions, input.label),
        'label',
        describeLabelRef(input.label),
      )

      const clash = definitionNamed(
        await repositories.labelDefinitions.listAll(),
        name,
        // Its own row is not a clash: renaming `migrated` to `Migrated` is a
        // case correction, and refusing it would make the one rename anybody
        // actually wants impossible.
        label.id,
      )
      if (clash !== undefined) {
        throw new ConflictError(`a label called "${clash.name}" already exists`)
      }

      const renamed = await repositories.labelDefinitions.rename(label.id, name)
      await repositories.events.append(
        newDomainEvent(
          'LabelRenamed',
          timestamp(this.clock),
          {},
          { labelId: renamed.id, from: label.name, to: renamed.name },
        ),
      )

      return { label: renamed }
    })
  }
}
