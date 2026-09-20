import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { createApp } from '@retro/core'
import { EXIT } from '#errors'
import { type Cli, createCli, removeTempStages } from './support/harness'

afterAll(removeTempStages)

/**
 * `label` and `attribute` — the AI's transport for the two vocabularies, and the
 * surface the configuration-write switch actually governs (testing.md suite 3).
 *
 * The config page carries a toggle the human can enable to give the AI the
 * ability to update the configs; while it is disabled, the human can be certain
 * the AI cannot change them.
 *
 * **The CLI is the AI**, always: there is no `--actor` on any command in this
 * product, so every write below is the actor that switch is about. That is what
 * makes this file the one place the guarantee can be exercised end to end
 * through a real transport — the browser's context is `human` unconditionally
 * and could never be refused by it.
 *
 * The switch itself is turned by writing through the App, because there is
 * deliberately **no CLI command for it**: it is human-only forever, whatever the
 * switch currently says, and the house shape for a human-only write is a
 * use-case refusal and no CLI surface at all. That the AI cannot reach it even
 * through the App is proved below every adapter, in
 * `packages/core/test/unit/settings.test.ts`.
 */
describe('the vocabularies, from the CLI', () => {
  let cli: Cli

  beforeEach(() => {
    cli = createCli()
  })

  /** The human, at the settings page — the only actor that may move the switch. */
  const allowTheAi = async (enabled: boolean): Promise<void> => {
    await createApp(cli.store, { clock: cli.clock }).settings.setAiConfigWrite.execute({
      actor: 'human',
      enabled,
    })
  }

  describe('while the switch is off — which is what a fresh install is', () => {
    /**
     * **Every write, refused, with the code a script can branch on.** Exit 5 is
     * `forbidden (actor rule)` (cli.md §Exit codes), and it arrives from
     * `FORBIDDEN_ACTOR` — the same code every other actor refusal in this
     * product carries, so no map grew a branch for this.
     */
    test('every definition write exits 5 and names the setting', async () => {
      const writes: readonly (readonly string[])[] = [
        ['label', 'create', 'migrated'],
        ['label', 'rename', 'migrated', '--to', 'moved'],
        ['label', 'retire', 'migrated'],
        // Un-retire is a definition write like the other three, so the switch
        // governs it identically (`r-retire-burns-a-word`). An act that could
        // put a word back into the vocabulary while the switch was off would be
        // a hole in the certainty that the AI cannot change the configuration.
        ['label', 'unretire', 'migrated'],
        ['attribute', 'create', 'ticket', '--type', 'number'],
        ['attribute', 'rename', 'ticket', '--to', 'issue'],
        ['attribute', 'retire', 'ticket'],
        ['attribute', 'unretire', 'ticket'],
      ]

      for (const argv of writes) {
        const result = await cli.run([...argv, '--json'])

        expect(result.code, argv.join(' ')).toBe(EXIT.forbidden)
        expect(result.error().code, argv.join(' ')).toBe('FORBIDDEN_ACTOR')
        // The message names the setting and says who moves it, because that is
        // the only thing the reader can act on — a `ForbiddenActorError`'s own
        // sentence would claim the act is the human's, which is untrue with the
        // switch on (`config-write.service.ts`).
        expect(result.error().message, argv.join(' ')).toMatch(/ai_config_write/)
        expect(result.error().message, argv.join(' ')).toMatch(/settings page/)
      }
    })

    /**
     * **The refusal comes before the store is asked anything**, which is why the
     * names above answer to nothing and it does not matter: the guard is the
     * first act inside the transaction, so a rename of a label that does not
     * exist is refused by the switch rather than by a NotFound wearing its
     * clothes. It is also what makes the guarantee mean the AI cannot *learn*
     * anything by trying.
     */
    test('nothing was written on the way to being refused', async () => {
      await cli.run(['label', 'create', 'migrated', '--json'])

      const listed = await cli.run(['label', 'list', '--json'])
      expect(listed.code).toBe(EXIT.ok)
      expect(listed.json()).toEqual({ labels: [] })
    })

    /** Reading is not writing: the AI may always see what a store holds. */
    test('both lists still answer', async () => {
      expect((await cli.run(['label', 'list', '--json'])).code).toBe(EXIT.ok)
      expect((await cli.run(['attribute', 'list', '--json'])).code).toBe(EXIT.ok)
    })
  })

  describe('once the human turns the switch on', () => {
    beforeEach(() => allowTheAi(true))

    /**
     * **No id is a literal here.** This harness runs on the memory store, whose
     * `IdGen` is one counter across every table, where SQLite gives each table
     * its own AUTOINCREMENT — so the first label is `3` here and `1` there, and
     * both are right. The id is taken from the answer that minted it, which is
     * what every other suite in this repo does for the same reason.
     */
    test('creates a label and lists it whole', async () => {
      const created = await cli.run(['label', 'create', '  migrated  ', '--json'])
      const id = created.jsonAs<{ id: number }>().id

      expect(created.code).toBe(EXIT.ok)
      expect(created.json()).toEqual({
        id,
        // Trimmed: a name is a token typed into a field, not prose.
        name: 'migrated',
        createdAt: '2026-08-23T09:00:00.000Z',
      })

      expect((await cli.run(['label', 'list', '--json'])).json()).toEqual({
        labels: [
          {
            id,
            name: 'migrated',
            // Null rather than absent, the way every optional in a `--json`
            // answer is: a reader telling "still offered" from "the field is
            // missing" would be branching on absence.
            retiredAt: null,
            createdAt: '2026-08-23T09:00:00.000Z',
          },
        ],
      })
    })

    test('creates an attribute with its type, and keeps it through a rename', async () => {
      const created = await cli.run(['attribute', 'create', 'ticket', '--type', 'number', '--json'])
      const id = created.jsonAs<{ id: number }>().id

      await cli.run(['attribute', 'rename', 'ticket', '--to', 'external ticket ID', '--json'])

      expect((await cli.run(['attribute', 'list', '--json'])).json()).toEqual({
        attributes: [
          {
            id,
            name: 'external ticket ID',
            type: 'number',
            retiredAt: null,
            createdAt: '2026-08-23T09:00:00.000Z',
          },
        ],
      })
    })

    /**
     * **Addressed by name, and case-insensitively**, because what an agent has
     * in hand is the word it read in `label list` — the same comparison that
     * refuses a duplicate, so one rule answers both questions
     * (`definition.service.ts`).
     */
    test('finds a definition by name whatever case it is typed in', async () => {
      await cli.run(['label', 'create', 'migrated', '--json'])

      const retired = await cli.run(['label', 'retire', 'MIGRATED', '--json'])

      expect(retired.code).toBe(EXIT.ok)
      expect(retired.jsonAs<{ retiredAt: string | null }>().retiredAt).toBe(
        '2026-08-23T09:00:00.000Z',
      )
    })

    /**
     * **The round trip, through the transport the AI actually drives** —
     * `r-retire-burns-a-word`. The `--json` answer carries `retiredAt: null`
     * rather than dropping the field, so a script can read "offered again"
     * without branching on absence, and the id is the id the definition was
     * minted with: nothing was re-created.
     */
    test('un-retires a label by name, and the id and name come back unchanged', async () => {
      const created = await cli.run(['label', 'create', 'migrated', '--json'])
      const id = created.jsonAs<{ id: number }>().id
      await cli.run(['label', 'retire', 'migrated', '--json'])

      const restored = await cli.run(['label', 'unretire', 'MIGRATED', '--json'])

      expect(restored.code).toBe(EXIT.ok)
      expect(restored.json()).toEqual({ id, name: 'migrated', retiredAt: null })
      expect((await cli.run(['label', 'list', '--json'])).json()).toEqual({
        labels: [{ id, name: 'migrated', retiredAt: null, createdAt: '2026-08-23T09:00:00.000Z' }],
      })
    })

    /** The type rides back with it, which is what makes an un-retire safe here. */
    test('un-retires an attribute, still of the type it was created with', async () => {
      const created = await cli.run(['attribute', 'create', 'ticket', '--type', 'number', '--json'])
      const id = created.jsonAs<{ id: number }>().id
      await cli.run(['attribute', 'retire', 'ticket', '--json'])

      const restored = await cli.run(['attribute', 'unretire', 'ticket', '--json'])

      expect(restored.code).toBe(EXIT.ok)
      expect(restored.json()).toEqual({ id, name: 'ticket', type: 'number', retiredAt: null })
    })

    /** Absorbing it would answer "done" to an act that did nothing. */
    test('un-retiring what is not retired is a conflict, exit 4', async () => {
      await cli.run(['label', 'create', 'migrated', '--json'])

      const refused = await cli.run(['label', 'unretire', 'migrated', '--json'])

      expect(refused.code).toBe(EXIT.conflict)
      expect(refused.error().code).toBe('CONFLICT')
      expect(refused.error().message).toMatch(/not retired/)
    })

    /** Retiring is not deleting: the row stays, and the name stays taken. */
    test('a retired label is still listed, and its name is still taken', async () => {
      await cli.run(['label', 'create', 'migrated', '--json'])
      await cli.run(['label', 'retire', 'migrated', '--json'])

      expect(
        (await cli.run(['label', 'list', '--json'])).jsonAs<{ labels: unknown[] }>().labels,
      ).toHaveLength(1)

      const again = await cli.run(['label', 'create', 'migrated', '--json'])
      expect(again.code).toBe(EXIT.conflict)
      expect(again.error().message).toMatch(/retired/)
    })

    test('a duplicate name is a conflict, exit 4', async () => {
      await cli.run(['label', 'create', 'migrated', '--json'])

      const clash = await cli.run(['label', 'create', 'MIGRATED', '--json'])

      expect(clash.code).toBe(EXIT.conflict)
      expect(clash.error().code).toBe('CONFLICT')
    })

    test('a name the domain refuses is usage, exit 2', async () => {
      const empty = await cli.run(['label', 'create', '   ', '--json'])

      expect(empty.code).toBe(EXIT.usage)
      expect(empty.error().code).toBe('VALIDATION')
    })

    test('a definition nothing answers to is not found, exit 3', async () => {
      const missing = await cli.run(['label', 'retire', 'nothing', '--json'])

      expect(missing.code).toBe(EXIT.notFound)
      expect(missing.error().code).toBe('NOT_FOUND')
    })

    /**
     * **There is no retype**, and the refusal says why rather than reporting an
     * unknown flag: an agent reaching for `--type` on a rename believes the type
     * is about to change, and telling it the flag does not exist teaches that it
     * mistyped something.
     */
    test('--type on a rename or a retire is refused, with the reason', async () => {
      await cli.run(['attribute', 'create', 'ticket', '--type', 'number', '--json'])

      for (const argv of [
        ['attribute', 'rename', 'ticket', '--to', 'issue', '--type', 'url'],
        ['attribute', 'retire', 'ticket', '--type', 'url'],
        ['attribute', 'unretire', 'ticket', '--type', 'url'],
      ]) {
        const refused = await cli.run([...argv, '--json'])
        expect(refused.code, argv.join(' ')).toBe(EXIT.usage)
        expect(refused.error().message, argv.join(' ')).toMatch(/fixed when it is created/)
      }
    })

    test('a create without a type is usage, and the message lists the four', async () => {
      const missing = await cli.run(['attribute', 'create', 'ticket', '--json'])

      expect(missing.code).toBe(EXIT.usage)
      expect(missing.error().message).toMatch(/number\|text\|url\|date/)
    })

    test('rename without --to is usage', async () => {
      await cli.run(['label', 'create', 'migrated', '--json'])

      expect((await cli.run(['label', 'rename', 'migrated', '--json'])).code).toBe(EXIT.usage)
    })

    /** A name on `list` is somebody expecting a filter, not somebody being verbose. */
    test('a name on list is refused rather than ignored', async () => {
      const filtered = await cli.run(['label', 'list', 'migrated', '--json'])

      expect(filtered.code).toBe(EXIT.usage)
      expect(filtered.error().message).toMatch(/lists the whole vocabulary/)
    })

    /**
     * **The switch is read inside the unit of work that would do the writing**,
     * so it cannot be stale: turning it back off stops the very next command,
     * with no restart and nothing cached.
     */
    test('turning the switch back off stops the next write immediately', async () => {
      await cli.run(['label', 'create', 'first', '--json'])

      await allowTheAi(false)

      const refused = await cli.run(['label', 'create', 'second', '--json'])
      expect(refused.code).toBe(EXIT.forbidden)
      expect(
        (await cli.run(['label', 'list', '--json']))
          .jsonAs<{ labels: { name: string }[] }>()
          .labels.map((label) => label.name),
      ).toEqual(['first'])
    })

    /** The human-readable half, since `--json` is not the only mode. */
    test('prints a line a person can read, and says what a retire does not do', async () => {
      await cli.run(['label', 'create', 'migrated'])
      const retired = await cli.run(['label', 'retire', 'migrated'])

      expect(retired.stdout.join('\n')).toContain('no longer offered')
      expect(retired.stdout.join('\n')).toContain('keep it')
    })
  })

  /**
   * **What is deliberately not here**, and it is a footprint difference worth
   * stating rather than a gap: there is no command that puts a label on a record
   * or sets a value on one.
   *
   * Those writes are human-only whatever the switch says — the
   * switch governs the *configuration*, and whether the AI may ever mark up its
   * own draft records is still open.
   * The house shape for a human-only write is a use-case refusal and no CLI
   * surface at all (`threads.resolve`, `review.finish`), and this follows it.
   *
   * `record archive` is the one deliberate departure in the product — offered
   * *and* refused, because it sits on the same command as `record resolve`,
   * which the AI uses constantly, so an agent will reach for it. Nothing in the
   * label or attribute surface sits beside such an act.
   */
  test('offers no way to put a label on a record, or set a value', async () => {
    await allowTheAi(true)

    for (const argv of [
      ['label', 'apply', 'migrated'],
      ['label', 'set', 'migrated'],
      ['attribute', 'set', 'ticket'],
    ]) {
      const result = await cli.run([...argv, '--json'])
      expect(result.code, argv.join(' ')).toBe(EXIT.usage)
    }
  })
})
