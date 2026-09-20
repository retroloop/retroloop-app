import { beforeEach, describe, expect, test } from 'bun:test'
import { ForbiddenActorError } from '#domain/errors/forbidden-actor.error'
import { AiConfigWriteDisabledError } from '#domain/services/config-write.service'
import { createHarness, type Harness } from '../support/harness'

/**
 * **A config page toggle the user can enable to let the AI update the configs —
 * disabled, the user can be certain the AI will not touch them — and the tests
 * that make that a guarantee rather than a convention.**
 *
 * Being certain is what this file is about. Everything below is asserted
 * **through the App**, below every adapter, because that is where the
 * enforcement lives: a page could be bypassed, a tRPC call could be
 * hand-rolled, and the AI runs in its own process against the same SQLite file.
 * Nothing here goes near a transport.
 */
describe('the AI-config-write toggle', () => {
  let harness: Harness

  beforeEach(() => {
    harness = createHarness()
  })

  /**
   * **Off is what a fresh install is, without anything having been written to
   * make it so.** A default that had to be inserted is a default that a failed
   * migration, a restored backup or a hand-made stage could be missing — and
   * "missing" would then have to mean something. Here it already does: no row
   * reads as off (`config-write.service.ts`).
   */
  test('is off on a store nobody has configured, with no row saying so', async () => {
    expect((await harness.app.settings.get.execute({ actor: 'human' })).aiConfigWrite).toBe(false)
    expect(await harness.store.settings.findLatest('ai_config_write')).toBeUndefined()
  })

  test('is on once the human turns it on, and off again when they turn it back', async () => {
    expect(
      (await harness.app.settings.setAiConfigWrite.execute({ actor: 'human', enabled: true }))
        .aiConfigWrite,
    ).toBe(true)
    expect((await harness.app.settings.get.execute({ actor: 'ai' })).aiConfigWrite).toBe(true)

    await harness.app.settings.setAiConfigWrite.execute({ actor: 'human', enabled: false })
    expect((await harness.app.settings.get.execute({ actor: 'ai' })).aiConfigWrite).toBe(false)
  })

  /**
   * **The history is the feature here**, which is why this is a versioned table
   * rather than a column. "It is off now" is a weaker answer to the certainty
   * this switch promises than "it has been off since the 27th, and here is
   * every time it moved" — and a column would have thrown the second one away
   * on the first change.
   *
   * Re-asserting what already stands still writes a row, unlike almost every
   * other act in this product: the human reaffirming a permission is a thing
   * that happened.
   */
  test('appends a version per act, re-asserting the same value included', async () => {
    for (const enabled of [true, false, false]) {
      await harness.app.settings.setAiConfigWrite.execute({ actor: 'human', enabled })
    }

    expect((await harness.store.settings.findLatest('ai_config_write'))?.version).toBe(3)
    expect(await harness.eventNames()).toEqual([
      'AiConfigWriteEnabled',
      'AiConfigWriteDisabled',
      'AiConfigWriteDisabled',
    ])
  })

  /**
   * **The one that has to hold: the AI cannot flip its own permission switch.**
   *
   * Asserted in both positions of the toggle, because the interesting one is the
   * second. With the switch off it is obvious; with the switch **on** the AI is
   * being handed the ability to write configs, and if the switch were one of
   * those configs the grant would be irreversible from the human's side — turn
   * it on once and the AI could turn it back on for ever. It is not one, and the
   * guard that says so is the first statement of the use case, above the
   * transaction, so no payload reaches the store to be refused later.
   */
  test('the AI can never move it — not even while it is on', async () => {
    for (const enabled of [false, true]) {
      await harness.app.settings.setAiConfigWrite.execute({ actor: 'human', enabled })

      await expect(
        harness.app.settings.setAiConfigWrite.execute({ actor: 'ai', enabled: true }),
      ).rejects.toBeInstanceOf(ForbiddenActorError)
      await expect(
        harness.app.settings.setAiConfigWrite.execute({ actor: 'ai', enabled: false }),
      ).rejects.toBeInstanceOf(ForbiddenActorError)

      // And nothing was written on the way to being refused.
      expect((await harness.app.settings.get.execute({ actor: 'human' })).aiConfigWrite).toBe(
        enabled,
      )
    }
  })

  /**
   * Reading the switch is open to the AI on purpose. Reading a permission is not
   * exercising it, and an agent that can see the switch is off can say so —
   * where one that could only bump into a refusal would report a failure with no
   * way out of it.
   */
  test('either actor may read it', async () => {
    for (const actor of ['ai', 'human'] as const) {
      expect((await harness.app.settings.get.execute({ actor })).aiConfigWrite).toBe(false)
    }
  })

  /**
   * **The whole point of the switch, from the AI's side.** Eight definition
   * writes, every one of them refused while it is off and accepted while it is
   * on — the base six plus the un-retire pair (`r-retire-burns-a-word`). An act
   * that the AI could take while the switch was off would be a hole in the
   * guarantee that the AI cannot touch configs while it is disabled, and
   * un-retire puts a word back into the vocabulary, which is exactly that kind
   * of change.
   *
   * The refusal is typed — `AiConfigWriteDisabledError`, carrying the
   * `FORBIDDEN_ACTOR` code — so it arrives as FORBIDDEN over tRPC and as exit 5
   * on the CLI without either map growing a branch (`config-write.service.ts`).
   */
  describe('the definition writes it governs', () => {
    /**
     * The eight writes the switch governs, in an order that composes: rename
     * runs before retire, **retire addresses the renamed definition**, and
     * un-retire runs after the retire it undoes — because the accepted run below
     * performs all eight in sequence against one store.
     *
     * That does not weaken the refused run. The guard is the first act inside
     * the transaction, above the resolve, so a name nothing answers to is never
     * reached there — the refusal is the switch's and not a NotFound wearing its
     * clothes, which is exactly the ordering the guarantee needs.
     */
    const attempts = (harness: Harness) =>
      [
        [
          'labels.define',
          () => harness.app.labels.define.execute({ actor: 'ai', name: 'migrated' }),
        ],
        [
          'labels.rename',
          () =>
            harness.app.labels.rename.execute({
              actor: 'ai',
              label: { labelName: 'known' },
              name: 'renamed',
            }),
        ],
        [
          'labels.retire',
          () => harness.app.labels.retire.execute({ actor: 'ai', label: { labelName: 'renamed' } }),
        ],
        [
          'labels.unretire',
          () =>
            harness.app.labels.unretire.execute({ actor: 'ai', label: { labelName: 'renamed' } }),
        ],
        [
          'attributes.define',
          () =>
            harness.app.attributes.define.execute({
              actor: 'ai',
              name: 'external issue id',
              type: 'url',
            }),
        ],
        [
          'attributes.rename',
          () =>
            harness.app.attributes.rename.execute({
              actor: 'ai',
              attribute: { attributeName: 'ticket' },
              name: 'renamed',
            }),
        ],
        [
          'attributes.retire',
          () =>
            harness.app.attributes.retire.execute({
              actor: 'ai',
              attribute: { attributeName: 'renamed' },
            }),
        ],
        [
          'attributes.unretire',
          () =>
            harness.app.attributes.unretire.execute({
              actor: 'ai',
              attribute: { attributeName: 'renamed' },
            }),
        ],
      ] as const satisfies readonly (readonly [string, () => Promise<unknown>])[]

    beforeEach(async () => {
      // Something for rename and retire to address, created by the human, who
      // never needs the switch.
      await harness.app.labels.define.execute({ actor: 'human', name: 'known' })
      await harness.app.attributes.define.execute({
        actor: 'human',
        name: 'ticket',
        type: 'number',
      })
    })

    test('every one of them is refused while the switch is off', async () => {
      for (const [name, attempt] of attempts(harness)) {
        await expect(
          attempt(),
          `${name} wrote while AI config writes were off`,
        ).rejects.toBeInstanceOf(AiConfigWriteDisabledError)
      }

      // The store is exactly as the human left it: two definitions, unrenamed
      // and unretired.
      const labels = (await harness.app.labels.list.execute({ actor: 'human' })).labels
      expect(labels.map((label) => [label.name, label.retiredAt])).toEqual([['known', undefined]])
    })

    /**
     * The refusal names the setting rather than saying the act is the human's,
     * because with the switch on it is not — a `ForbiddenActorError`'s own
     * sentence would send the reader looking for a rule that does not exist.
     */
    test('the refusal says which setting is in the way and who can move it', async () => {
      await expect(
        harness.app.labels.define.execute({ actor: 'ai', name: 'migrated' }),
      ).rejects.toThrow(/ai_config_write.*settings page/s)
    })

    test('every one of them is accepted once the human turns it on', async () => {
      await harness.app.settings.setAiConfigWrite.execute({ actor: 'human', enabled: true })

      for (const [name, attempt] of attempts(harness)) {
        await expect(
          attempt(),
          `${name} was refused while AI config writes were on`,
        ).resolves.toBeDefined()
      }
    })

    /**
     * **The switch is read inside the unit of work that would do the writing**,
     * so an answer cannot be stale by the time the write happens. Turning it off
     * between two AI writes stops the second one.
     */
    test('turning it off stops the next write, without a restart or a reconnect', async () => {
      await harness.app.settings.setAiConfigWrite.execute({ actor: 'human', enabled: true })
      await harness.app.labels.define.execute({ actor: 'ai', name: 'first' })

      await harness.app.settings.setAiConfigWrite.execute({ actor: 'human', enabled: false })

      await expect(
        harness.app.labels.define.execute({ actor: 'ai', name: 'second' }),
      ).rejects.toBeInstanceOf(AiConfigWriteDisabledError)
      expect(
        (await harness.app.labels.list.execute({ actor: 'ai' })).labels.map((one) => one.name),
      ).toEqual(['known', 'first'])
    })
  })

  /**
   * **The switch governs the configuration and nothing else.** Applying a label
   * and setting a value are human-only *whatever it says* — that write side is
   * left for a later change by design, and the toggle is only about the ability
   * to update the configs.
   */
  test('does not open the record write side to the AI, in either position', async () => {
    const session = await harness.session()
    const { retroId, revision } = await harness.revision(session.id)
    const rid = revision.records[0]?.rid ?? ''
    await harness.app.labels.define.execute({ actor: 'human', name: 'migrated' })
    await harness.app.attributes.define.execute({ actor: 'human', name: 'ticket', type: 'number' })

    for (const enabled of [false, true]) {
      await harness.app.settings.setAiConfigWrite.execute({ actor: 'human', enabled })

      await expect(
        harness.app.labels.apply.execute({
          actor: 'ai',
          retro: { retroId },
          rid,
          label: { labelName: 'migrated' },
          applied: true,
        }),
      ).rejects.toBeInstanceOf(ForbiddenActorError)
      await expect(
        harness.app.attributes.set.execute({
          actor: 'ai',
          retro: { retroId },
          rid,
          attribute: { attributeName: 'ticket' },
          value: '4192',
        }),
      ).rejects.toBeInstanceOf(ForbiddenActorError)
    }
  })
})
