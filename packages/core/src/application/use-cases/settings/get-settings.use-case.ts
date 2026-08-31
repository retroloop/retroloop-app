import type { Store } from '#application/ports/store.port'
import type { Actor } from '#domain/models/actor.model'
import { AI_CONFIG_WRITE } from '#domain/models/setting.model'
import { aiConfigWriteEnabled } from '#domain/services/config-write.service'

export type GetSettingsInput = {
  /** Reads are open to both actors; only writes are actor-bound. */
  readonly actor: Actor
}

export type GetSettingsOutput = {
  /**
   * Whether the AI may write label and attribute definitions right now — OWNER
   * RULING 2's toggle, read as a boolean rather than as the row behind it.
   *
   * A store nobody has configured has no row and answers `false`, which is the
   * safe state a fresh install is born in (`config-write.service.ts`).
   */
  readonly aiConfigWrite: boolean
}

/**
 * The settings, as the settings page and the AI both read them.
 *
 * **Open to the AI on purpose, and it is not a hole in the guarantee.** Reading
 * a permission is not exercising it, and an agent that can see the switch is off
 * can say so — *"I cannot create that label; ask the human to enable AI config
 * writes"* — where one that could only bump into a refusal would report a
 * failure with no way out of it. The guarantee is about writing, and the write
 * path is `SetAiConfigWriteUseCase`, which refuses the AI outright and forever.
 *
 * One key today, and the shape is a **named boolean rather than a key-value
 * bag**: there is exactly one setting, every reader wants this one, and a map
 * would make the page ask "is `ai_config_write` in here, and what does a missing
 * key mean" — a question the default already answers here, once.
 */
export class GetSettingsUseCase {
  constructor(private readonly store: Store) {}

  async execute(_input: GetSettingsInput): Promise<GetSettingsOutput> {
    return {
      aiConfigWrite: aiConfigWriteEnabled(await this.store.settings.findLatest(AI_CONFIG_WRITE)),
    }
  }
}
