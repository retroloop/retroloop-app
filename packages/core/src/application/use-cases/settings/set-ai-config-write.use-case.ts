import { type Clock, timestamp } from '#application/ports/clock.port'
import type { Store } from '#application/ports/store.port'
import { ForbiddenActorError } from '#domain/errors/forbidden-actor.error'
import { newDomainEvent } from '#domain/events/domain-event.model'
import type { Actor } from '#domain/models/actor.model'
import { AI_CONFIG_WRITE, SETTING_OFF, SETTING_ON } from '#domain/models/setting.model'

export type SetAiConfigWriteInput = {
  /**
   * **Human, forever, whatever the setting currently says.**
   *
   * This is the one line the whole guarantee rests on. A permission switch its
   * own subject can flip is not a permission switch, so the AI is refused here
   * even while the toggle is *on* — turning it on grants the AI the ability to
   * write definitions and nothing else, and it can never turn it back on after a
   * human turns it off. There is no CLI command for this either, which is the
   * house shape for a human-only write (`threads.resolve`, `review.finish`), but
   * the CLI's absence is not what enforces it: this guard is, below every
   * adapter.
   */
  readonly actor: Actor
  readonly enabled: boolean
}

export type SetAiConfigWriteOutput = {
  readonly aiConfigWrite: boolean
  /** The version just written, 1-based and dense per key. */
  readonly version: number
}

/**
 * The human decides whether the AI may write label and attribute definitions —
 * OWNER RULING 2, verbatim:
 *
 * > *"In the config page add a toggle that the user can enable to give the AI
 * > the ability to update the configs. Otherwise, if it is disabled, the user
 * > can be certain that the AI cannot mess around."*
 *
 * **An append, not an edit.** *"The user can be certain"* is a claim about the
 * past as much as the present: the store keeps every version, so "it has been
 * off since the 27th" is readable rather than inferable. Setting it to what it
 * already says still writes a row, unlike almost every other act in this
 * product, and that is deliberate for the same reason — the human reaffirming a
 * permission is a thing that happened, and this is the one table where the
 * history *is* the feature.
 *
 * **The guard is the first statement**, above the transaction, exactly as
 * `ResolveThreadUseCase` opens with one: an actor who may not do a thing is told
 * so before the store is asked anything about it, and no transport can route
 * around it by sending a different payload.
 */
export class SetAiConfigWriteUseCase {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}

  async execute(input: SetAiConfigWriteInput): Promise<SetAiConfigWriteOutput> {
    ForbiddenActorError.assert(
      'human',
      input.actor,
      'changing whether the AI may write label and attribute definitions',
    )

    return this.store.tx(async (repositories) => {
      const previous = await repositories.settings.findLatest(AI_CONFIG_WRITE)
      const at = timestamp(this.clock)
      const written = await repositories.settings.add({
        key: AI_CONFIG_WRITE,
        version: (previous?.version ?? 0) + 1,
        value: input.enabled ? SETTING_ON : SETTING_OFF,
        at,
      })

      await repositories.events.append(
        newDomainEvent(
          input.enabled ? 'AiConfigWriteEnabled' : 'AiConfigWriteDisabled',
          at,
          // Global, like the definitions it governs: no session, no
          // retrospective, no record. Nothing subscribes to it — `events.onRetro`
          // is per-retrospective — and it is written all the same, because the
          // outbox is this store's audit trail and this is the row a reader
          // asking "when did that get turned on" will want.
          {},
          { version: written.version, value: written.value },
        ),
      )

      return { aiConfigWrite: input.enabled, version: written.version }
    })
  }
}
