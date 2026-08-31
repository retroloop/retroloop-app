import { beforeEach, describe, expect, test } from 'bun:test'
import { ConflictError } from '#domain/errors/conflict.error'
import { ForbiddenActorError } from '#domain/errors/forbidden-actor.error'
import { NotFoundError } from '#domain/errors/not-found.error'
import { ValidationError } from '#domain/errors/validation.error'
import { createHarness, type Harness } from '../support/harness'

/**
 * Labels — the primitive the owner ruled into its purest possible shape:
 *
 * > *"I don't like the idea of label + notes; that is not a standard practice.
 * > Usually labels are just labels."*
 *
 * So there is nothing in this file about a payload, a colour, a description or a
 * pairing with an attribute. What there is: a vocabulary somebody creates, a
 * name they can correct, a way to stop offering one without losing what it
 * classified, and a record that wears it.
 */
describe('labels', () => {
  let harness: Harness

  beforeEach(() => {
    harness = createHarness()
  })

  const names = async (): Promise<readonly string[]> =>
    (await harness.app.labels.list.execute({ actor: 'human' })).labels.map((label) => label.name)

  describe('the vocabulary', () => {
    /**
     * **The product ships none.** *"To keep it flexible we will not hardcode any
     * labels or attributes"* — so an untouched store answers with an empty list,
     * and `migrated` is not there, because it is the example he used rather than
     * a value this product knows about.
     */
    test('is empty until somebody creates one, and `migrated` is not special', async () => {
      expect(await names()).toEqual([])

      await harness.app.labels.define.execute({ actor: 'human', name: 'migrated' })

      expect(await names()).toEqual(['migrated'])
    })

    test('keeps the name trimmed, as typed, in minting order', async () => {
      for (const name of ['  migrated  ', 'needs-triage', 'Upstream']) {
        await harness.app.labels.define.execute({ actor: 'human', name })
      }

      expect(await names()).toEqual(['migrated', 'needs-triage', 'Upstream'])
    })

    /**
     * **Uniqueness ignores case, and it is decided in the domain rather than by
     * a collation** (`definition.service.ts`). A store holding `Migrated` and
     * `migrated` is a store whose settings page shows two rows a reader cannot
     * tell apart and whose filter splits one classification in half.
     */
    test('refuses a second label whose name differs only in case', async () => {
      await harness.app.labels.define.execute({ actor: 'human', name: 'migrated' })

      await expect(
        harness.app.labels.define.execute({ actor: 'human', name: 'MIGRATED' }),
      ).rejects.toBeInstanceOf(ConflictError)
      expect(await names()).toEqual(['migrated'])
    })

    /**
     * A retired name is still taken. The label is on records, it is rendering,
     * and a second label reusing the word would make two classifications read as
     * one thing on the same page — retiring stops a label being offered, not
     * being read.
     */
    test('refuses to reuse the name of a retired label', async () => {
      await harness.app.labels.define.execute({ actor: 'human', name: 'migrated' })
      await harness.app.labels.retire.execute({ actor: 'human', label: { labelName: 'migrated' } })

      await expect(
        harness.app.labels.define.execute({ actor: 'human', name: 'migrated' }),
      ).rejects.toThrow(/retired/)
    })

    test('refuses a name that is empty, too long, or more than one line', async () => {
      for (const name of ['', '   ', 'x'.repeat(41), 'two\nlines']) {
        await expect(
          harness.app.labels.define.execute({ actor: 'human', name }),
          `"${name}" was accepted`,
        ).rejects.toBeInstanceOf(ValidationError)
      }
    })

    /**
     * A rename writes over the row, so **every record wearing the label reads
     * the new name at once** — which is what makes a definition configuration
     * rather than human data (`rename-label.use-case.ts`).
     */
    test('renaming changes the name on every record that wears it', async () => {
      const session = await harness.session()
      const { retroId, revision } = await harness.revision(session.id)
      const rid = revision.records[0]?.rid ?? ''
      await harness.app.labels.define.execute({ actor: 'human', name: 'migratd' })
      await harness.app.labels.apply.execute({
        actor: 'human',
        retro: { retroId },
        rid,
        label: { labelName: 'migratd' },
        applied: true,
      })

      await harness.app.labels.rename.execute({
        actor: 'human',
        label: { labelName: 'migratd' },
        name: 'migrated',
      })

      const record = await harness.app.records.get.execute({
        actor: 'human',
        retro: { retroId },
        rid,
      })
      expect(record.labels.map((label) => label.name)).toEqual(['migrated'])
    })

    /** Its own name is not a clash — the one rename anybody actually wants. */
    test('renaming a label to its own name in another case is a correction', async () => {
      await harness.app.labels.define.execute({ actor: 'human', name: 'migrated' })

      await harness.app.labels.rename.execute({
        actor: 'human',
        label: { labelName: 'migrated' },
        name: 'Migrated',
      })

      expect(await names()).toEqual(['Migrated'])
    })

    test('refuses a rename onto another label’s name', async () => {
      await harness.app.labels.define.execute({ actor: 'human', name: 'migrated' })
      await harness.app.labels.define.execute({ actor: 'human', name: 'needs-triage' })

      await expect(
        harness.app.labels.rename.execute({
          actor: 'human',
          label: { labelName: 'needs-triage' },
          name: 'MIGRATED',
        }),
      ).rejects.toBeInstanceOf(ConflictError)
    })

    /** Retiring is not a delete: the row stays, and the name goes on rendering. */
    test('retiring keeps the definition and stamps when it stopped being offered', async () => {
      await harness.app.labels.define.execute({ actor: 'human', name: 'migrated' })

      const { label } = await harness.app.labels.retire.execute({
        actor: 'human',
        label: { labelName: 'migrated' },
      })

      expect(label.retiredAt).toBe(harness.clock.iso())
      expect(await names()).toEqual(['migrated'])
    })

    test('refuses to retire a label twice', async () => {
      await harness.app.labels.define.execute({ actor: 'human', name: 'migrated' })
      await harness.app.labels.retire.execute({ actor: 'human', label: { labelName: 'migrated' } })

      await expect(
        harness.app.labels.retire.execute({ actor: 'human', label: { labelName: 'migrated' } }),
      ).rejects.toBeInstanceOf(ConflictError)
    })

    test('is a NotFound for a label nothing answers to, by name or by id', async () => {
      for (const label of [{ labelName: 'nothing' }, { labelId: 404 }] as const) {
        await expect(
          harness.app.labels.retire.execute({ actor: 'human', label }),
        ).rejects.toBeInstanceOf(NotFoundError)
        await expect(
          harness.app.labels.unretire.execute({ actor: 'human', label }),
        ).rejects.toBeInstanceOf(NotFoundError)
      }
    })

    /**
     * **Retire is reversible, and that is the whole of retro-11
     * `r-retire-burns-a-word`** — his selected solution 2: *"a retired
     * definition can be brought back to offerable by the human — same row, same
     * one-press shape, no history rewritten, the name never freed either way."*
     *
     * The round trip is asserted as a return to the *same row*, not merely to an
     * offerable one: a store that answered by minting a fresh definition would
     * satisfy "it is offered again" while quietly orphaning every record wearing
     * the old id.
     */
    test('un-retiring offers the same row again, with nothing else changed', async () => {
      const { label } = await harness.app.labels.define.execute({
        actor: 'human',
        name: 'migrated',
      })
      await harness.app.labels.retire.execute({ actor: 'human', label: { labelName: 'migrated' } })

      const restored = await harness.app.labels.unretire.execute({
        actor: 'human',
        label: { labelName: 'migrated' },
      })

      expect(restored.label).toEqual(label)
      expect(restored.label.retiredAt).toBeUndefined()
      expect(await names()).toEqual(['migrated'])
    })

    /**
     * Absorbing this would be the quiet inference this product refuses
     * everywhere else — the same standing that refuses a second retire, read the
     * other way round.
     */
    test('refuses to un-retire a label that is not retired', async () => {
      await harness.app.labels.define.execute({ actor: 'human', name: 'migrated' })

      await expect(
        harness.app.labels.unretire.execute({ actor: 'human', label: { labelName: 'migrated' } }),
      ).rejects.toBeInstanceOf(ConflictError)
    })

    /**
     * **The name was never freed, so nothing has to be given back.** A retired
     * name stays taken precisely so a second definition cannot reuse the word,
     * which means un-retiring can never collide with anything — and the label
     * that comes back is the one every record was already wearing.
     */
    test('the name stays taken throughout, so the round trip cannot collide', async () => {
      await harness.app.labels.define.execute({ actor: 'human', name: 'migrated' })
      await harness.app.labels.retire.execute({ actor: 'human', label: { labelName: 'migrated' } })

      await expect(
        harness.app.labels.define.execute({ actor: 'human', name: 'MIGRATED' }),
      ).rejects.toBeInstanceOf(ConflictError)

      await harness.app.labels.unretire.execute({
        actor: 'human',
        label: { labelName: 'migrated' },
      })

      expect(await names()).toEqual(['migrated'])
    })

    /** Both handles reach the same row: the browser holds ids, the CLI holds names. */
    test('addresses a definition by id and by name alike', async () => {
      const { label } = await harness.app.labels.define.execute({
        actor: 'human',
        name: 'migrated',
      })

      await harness.app.labels.rename.execute({
        actor: 'human',
        label: { labelId: label.id },
        name: 'moved',
      })
      await harness.app.labels.retire.execute({ actor: 'human', label: { labelName: 'MOVED' } })

      expect((await harness.app.labels.list.execute({ actor: 'ai' })).labels[0]?.retiredAt).toBe(
        harness.clock.iso(),
      )
    })

    test('announces every act on the outbox, one name per act', async () => {
      await harness.app.labels.define.execute({ actor: 'human', name: 'migrated' })
      await harness.app.labels.rename.execute({
        actor: 'human',
        label: { labelName: 'migrated' },
        name: 'moved',
      })
      await harness.app.labels.retire.execute({ actor: 'human', label: { labelName: 'moved' } })

      await harness.app.labels.unretire.execute({ actor: 'human', label: { labelName: 'moved' } })

      expect(await harness.eventNames()).toEqual([
        'LabelDefined',
        'LabelRenamed',
        'LabelRetired',
        // A name of its own, like every other pair in the set: a reader should
        // not have to unpack a payload to learn which way the act went.
        'LabelUnretired',
      ])
    })
  })

  describe('a label on a record', () => {
    let retroId: number
    let rid: string

    beforeEach(async () => {
      const session = await harness.session()
      const filed = await harness.revision(session.id)
      retroId = filed.retroId
      rid = filed.revision.records[0]?.rid ?? ''
      await harness.app.labels.define.execute({ actor: 'human', name: 'migrated' })
    })

    const apply = (applied: boolean, name = 'migrated') =>
      harness.app.labels.apply.execute({
        actor: 'human',
        retro: { retroId },
        rid,
        label: { labelName: name },
        applied,
      })

    const wornBy = async (): Promise<readonly string[]> =>
      (
        await harness.app.records.get.execute({ actor: 'human', retro: { retroId }, rid })
      ).labels.map((label) => label.name)

    test('goes on, comes off, and both are versions rather than edits', async () => {
      expect((await apply(true)).version).toBe(1)
      expect(await wornBy()).toEqual(['migrated'])

      expect((await apply(false)).version).toBe(2)
      expect(await wornBy()).toEqual([])

      // Putting it back is version 3, not version 1 — the history is all there.
      expect((await apply(true)).version).toBe(3)
      expect(
        (await harness.store.recordLabels.listForRecord(retroId, rid)).map((one) => [
          one.version,
          one.applied,
        ]),
      ).toEqual([
        [1, true],
        [2, false],
        [3, true],
      ])
    })

    /**
     * **Human-only this session**, whatever the AI-config-write toggle says: the
     * toggle governs the definitions, and whether the AI may mark up its own
     * draft records is one of the opens the owner's ruling did not reach
     * (`settings.test.ts` asserts both positions of the switch).
     */
    test('is refused to the AI', async () => {
      await expect(
        harness.app.labels.apply.execute({
          actor: 'ai',
          retro: { retroId },
          rid,
          label: { labelName: 'migrated' },
          applied: true,
        }),
      ).rejects.toBeInstanceOf(ForbiddenActorError)
    })

    /** Each label has a version sequence of its own — three labels, three v1 rows. */
    test('numbers each label’s versions on its own', async () => {
      await harness.app.labels.define.execute({ actor: 'human', name: 'needs-triage' })

      expect((await apply(true)).version).toBe(1)
      expect((await apply(true, 'needs-triage')).version).toBe(1)
      expect((await apply(false)).version).toBe(2)

      expect(await wornBy()).toEqual(['needs-triage'])
    })

    /**
     * A no-op is refused rather than absorbed, on the standing
     * `LIFECYCLE_ACT_FROM` sets: answering "done" to an act that did nothing is
     * the quiet inference this product refuses everywhere else.
     */
    test('refuses to apply a label the record already wears, or remove one it does not', async () => {
      await expect(apply(false)).rejects.toBeInstanceOf(ConflictError)

      await apply(true)
      await expect(apply(true)).rejects.toBeInstanceOf(ConflictError)
    })

    /**
     * A retired label cannot be applied and can always be removed. The asymmetry
     * is the point: a record left wearing a retired label with no way to take it
     * off would be a classification nobody can correct.
     */
    test('cannot be applied once retired, and can still be removed', async () => {
      await apply(true)
      await harness.app.labels.retire.execute({ actor: 'human', label: { labelName: 'migrated' } })

      await harness.app.labels.define.execute({ actor: 'human', name: 'needs-triage' })
      await harness.app.labels.retire.execute({
        actor: 'human',
        label: { labelName: 'needs-triage' },
      })
      await expect(apply(true, 'needs-triage')).rejects.toThrow(/retired/)

      await apply(false)
      expect(await wornBy()).toEqual([])
    })

    /**
     * **The offering comes back with the label**, which is what makes un-retire
     * a real undo rather than a flag nobody reads: the same call that was
     * refused a moment ago is accepted, and it is the *same definition* — the
     * record's own history of wearing it is one sequence, not two.
     */
    test('can be applied again once it is un-retired', async () => {
      await harness.app.labels.retire.execute({ actor: 'human', label: { labelName: 'migrated' } })
      await expect(apply(true)).rejects.toThrow(/retired/)

      await harness.app.labels.unretire.execute({
        actor: 'human',
        label: { labelName: 'migrated' },
      })

      expect((await apply(true)).version).toBe(1)
      expect(await wornBy()).toEqual(['migrated'])
    })

    /** The retired label goes on rendering where it was applied, and says so. */
    test('renders a retired label it already wears, marked retired', async () => {
      await apply(true)
      await harness.app.labels.retire.execute({ actor: 'human', label: { labelName: 'migrated' } })

      const record = await harness.app.records.get.execute({
        actor: 'human',
        retro: { retroId },
        rid,
      })
      expect(record.labels).toEqual([
        { id: record.labels[0]?.id ?? 0, name: 'migrated', retired: true },
      ])
    })

    test('is a NotFound for a record the latest revision does not carry', async () => {
      await expect(
        harness.app.labels.apply.execute({
          actor: 'human',
          retro: { retroId },
          rid: 'r-ghost',
          label: { labelName: 'migrated' },
          applied: true,
        }),
      ).rejects.toBeInstanceOf(NotFoundError)
    })

    test('announces the act on the record’s own retrospective stream', async () => {
      await apply(true)
      await apply(false)

      const { events } = await harness.app.events.list.execute({ actor: 'ai', retro: { retroId } })
      expect(
        events
          .filter((event) => event.name.startsWith('RecordLabel'))
          .map((event) => [event.name, event.rid, event.revisionN]),
      ).toEqual([
        // No revision: a label outlives every redraft of the record it is on.
        ['RecordLabelApplied', rid, undefined],
        ['RecordLabelRemoved', rid, undefined],
      ])
    })
  })
})
