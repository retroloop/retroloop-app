import { type Clock, timestamp } from '#application/ports/clock.port'
import type { Store } from '#application/ports/store.port'
import { ConflictError } from '#domain/errors/conflict.error'
import { NotFoundError } from '#domain/errors/not-found.error'
import { newDomainEvent } from '#domain/events/domain-event.model'
import type { Actor } from '#domain/models/actor.model'
import type { LabelDefinition } from '#domain/models/label.model'
import { assertAiMayWriteDefinitions } from '#domain/services/config-write.service'
import {
  describeLabelRef,
  isOfferable,
  type LabelRef,
  resolveLabel,
} from '#domain/services/definition.service'

export type RetireLabelInput = {
  readonly actor: Actor
  readonly label: LabelRef
}

export type RetireLabelOutput = { readonly label: LabelDefinition }

/**
 * A label stops being offered — **and stops being nothing else.**
 *
 * This is the settings page's third act, and it is deliberately not a delete.
 * The records that already wear the label go on wearing it, the name goes on
 * rendering, and the filter goes on offering it while any record still carries
 * it. What retiring takes away is the label's place on the list of things
 * anybody can apply next.
 *
 * It is the same doctrine as `decline is a state, not a deletion` and as
 * archiving rather than deleting a record, so that its discussion is still
 * kept. A delete here would silently rewrite the past of every record that had
 * been classified, which is the one thing this store never does.
 *
 * **Retiring twice is refused rather than absorbed**, on the standing
 * `LIFECYCLE_ACT_FROM` sets: answering "done" to an act that did nothing is the
 * quiet inference this product refuses everywhere else, and a caller retiring an
 * already-retired label believes the store says something it does not.
 *
 * **Un-retire is the act beside it** (`r-retire-burns-a-word`). A fourth control
 * was held back until a retrospective asked for one, and one did: retiring was a
 * single press with no confirmation and no way back, so a mis-press permanently
 * burned a word the store can never free. `UnretireLabelUseCase` is the answer,
 * and it cost one repository method and undid nothing.
 *
 * **What that does not change is anything about this use case.** Retiring is
 * still not a delete, a second retire is still refused, and the name is still
 * taken forever. Reversible is not the same as undone.
 */
export class RetireLabelUseCase {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}

  async execute(input: RetireLabelInput): Promise<RetireLabelOutput> {
    return this.store.tx(async (repositories) => {
      await assertAiMayWriteDefinitions(repositories.settings, input.actor, 'retiring a label')

      const label = NotFoundError.require(
        await resolveLabel(repositories.labelDefinitions, input.label),
        'label',
        describeLabelRef(input.label),
      )
      if (!isOfferable(label)) {
        throw new ConflictError(
          `the label "${label.name}" was already retired at ${label.retiredAt}`,
        )
      }

      const at = timestamp(this.clock)
      const retired = await repositories.labelDefinitions.retire(label.id, at)
      await repositories.events.append(
        newDomainEvent('LabelRetired', at, {}, { labelId: retired.id, name: retired.name }),
      )

      return { label: retired }
    })
  }
}
