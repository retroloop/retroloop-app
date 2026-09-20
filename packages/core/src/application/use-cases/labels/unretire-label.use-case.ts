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

export type UnretireLabelInput = {
  readonly actor: Actor
  readonly label: LabelRef
}

export type UnretireLabelOutput = { readonly label: LabelDefinition }

/**
 * A retired label is offered again — **the act that makes retiring reversible**,
 * and the whole of `r-retire-burns-a-word`: un-retire, symmetric with retire, so
 * a retired definition can be brought back to offerable by the human — same row,
 * same one-press shape, no history rewritten, the name never freed either way.
 *
 * The record it closes is the sharpest edge the labels build shipped: retire was
 * one press, with no confirmation and no way back, so a mis-press permanently
 * burned a word out of a vocabulary the store can never free. **A confirm dialog
 * was the alternative and it was dropped on purpose** — it taxes every
 * legitimate retire forever to guard against the rare slip, where reversibility
 * guards the slip and taxes nothing. It is also the rule the rest of this
 * product already lives by: decline is a state, unarchive exists, reopen exists.
 *
 * **Nothing is rewritten and nothing is freed.** The row is the same row, the
 * name was never given up (a retired name stays taken so a second definition
 * cannot reuse the word), and every record wearing the label went on wearing it
 * throughout — the only thing that changes is whether anybody can apply it next.
 * The two acts a round trip leaves behind are two rows in the outbox, which is
 * where this store's history actually lives.
 *
 * **Un-retiring what is not retired is refused rather than absorbed**, the same
 * standing `RetireLabelUseCase` takes the other way: answering "done" to an act
 * that did nothing is the quiet inference this product refuses everywhere.
 *
 * **It is a definition write, so the switch governs it** exactly as it governs
 * the other three (`config-write.service.ts`): with AI config writes off the AI
 * is refused before the store is asked anything, and the human is never.
 */
export class UnretireLabelUseCase {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}

  async execute(input: UnretireLabelInput): Promise<UnretireLabelOutput> {
    return this.store.tx(async (repositories) => {
      await assertAiMayWriteDefinitions(repositories.settings, input.actor, 'un-retiring a label')

      const label = NotFoundError.require(
        await resolveLabel(repositories.labelDefinitions, input.label),
        'label',
        describeLabelRef(input.label),
      )
      if (isOfferable(label)) {
        throw new ConflictError(`the label "${label.name}" is not retired`)
      }

      const restored = await repositories.labelDefinitions.unretire(label.id)
      await repositories.events.append(
        newDomainEvent(
          'LabelUnretired',
          timestamp(this.clock),
          {},
          { labelId: restored.id, name: restored.name },
        ),
      )

      return { label: restored }
    })
  }
}
