import { beforeEach, describe, expect, test } from 'bun:test'
import { ConflictError } from '#domain/errors/conflict.error'
import { ForbiddenActorError } from '#domain/errors/forbidden-actor.error'
import { NotFoundError } from '#domain/errors/not-found.error'
import { ValidationError } from '#domain/errors/validation.error'
import { createHarness, type Harness } from '../support/harness'

/**
 * Attributes — the queryable primitive: a vocabulary somebody creates that
 * names a value and fixes its type, for example "Jira ticket" typed as a
 * number, so that records carrying it can be queried on it.
 *
 * The vocabulary half of this file is the label file's twin and is kept short
 * for that reason (`labels.test.ts` carries the arguments). What is here that is
 * not there is the type: four of them, validated exactly as far as each one's
 * name promises, with fixed types rather than a general validation config so
 * there is no configuration surface to get wrong.
 */
describe('attributes', () => {
  let harness: Harness

  beforeEach(() => {
    harness = createHarness()
  })

  describe('the vocabulary', () => {
    test('is empty until somebody creates one, and carries the type they chose', async () => {
      expect((await harness.app.attributes.list.execute({ actor: 'ai' })).attributes).toEqual([])

      const { attribute } = await harness.app.attributes.define.execute({
        actor: 'human',
        name: 'external issue id',
        type: 'url',
      })

      expect([attribute.name, attribute.type, attribute.retiredAt]).toEqual([
        'external issue id',
        'url',
        undefined,
      ])
    })

    test('refuses a second attribute whose name differs only in case', async () => {
      await harness.app.attributes.define.execute({
        actor: 'human',
        name: 'ticket',
        type: 'number',
      })

      await expect(
        harness.app.attributes.define.execute({ actor: 'human', name: 'TICKET', type: 'text' }),
      ).rejects.toBeInstanceOf(ConflictError)
    })

    /**
     * **The two vocabularies do not collide with each other**, and that is the
     * ruling rather than an oversight: labels and attributes are pure and
     * independent, so a label called `migrated` and an attribute called
     * `migrated` are two different things and refusing the pair would be the
     * system enforcing a relationship that does not exist.
     */
    test('may share a name with a label', async () => {
      await harness.app.labels.define.execute({ actor: 'human', name: 'migrated' })

      await harness.app.attributes.define.execute({
        actor: 'human',
        name: 'migrated',
        type: 'date',
      })

      expect(
        (await harness.app.attributes.list.execute({ actor: 'ai' })).attributes.map((one) => [
          one.name,
          one.type,
        ]),
      ).toEqual([['migrated', 'date']])
    })

    test('renames and retires, and refuses a second retire', async () => {
      await harness.app.attributes.define.execute({
        actor: 'human',
        name: 'ticket',
        type: 'number',
      })

      await harness.app.attributes.rename.execute({
        actor: 'human',
        attribute: { attributeName: 'ticket' },
        name: 'external ticket ID',
      })
      const { attribute } = await harness.app.attributes.retire.execute({
        actor: 'human',
        attribute: { attributeName: 'external ticket ID' },
      })

      expect(attribute.retiredAt).toBe(harness.clock.iso())
      await expect(
        harness.app.attributes.retire.execute({
          actor: 'human',
          attribute: { attributeId: attribute.id },
        }),
      ).rejects.toBeInstanceOf(ConflictError)
    })

    /**
     * **A rename never touches the type**, and there is no way to change one:
     * every value already stored was accepted under the type the row carries,
     * and this store never rewrites what somebody wrote. Retiring and redefining
     * is the whole of the alternative (`attribute.model.ts`).
     */
    test('keeps the type through a rename, and offers no way to change it', async () => {
      await harness.app.attributes.define.execute({
        actor: 'human',
        name: 'ticket',
        type: 'number',
      })

      const { attribute } = await harness.app.attributes.rename.execute({
        actor: 'human',
        attribute: { attributeName: 'ticket' },
        name: 'issue',
      })

      expect(attribute.type).toBe('number')
      expect(Object.keys(harness.app.attributes).sort()).toEqual([
        'define',
        'list',
        'rename',
        'retire',
        'set',
        // Retire's inverse (`r-retire-burns-a-word`) — and still no
        // `retype`, which is the absence this assertion exists for.
        'unretire',
      ])
    })

    /**
     * **Retire is reversible here too**, and the type is what makes it safe: an
     * attribute comes back offering the type it always had, so every value
     * stored under it stays as true as it was and there is still no path that
     * changes one (the chosen solution covers both definition kinds).
     */
    test('un-retires the same row, keeping its type, and refuses a second un-retire', async () => {
      const defined = await harness.app.attributes.define.execute({
        actor: 'human',
        name: 'ticket',
        type: 'number',
      })
      await harness.app.attributes.retire.execute({
        actor: 'human',
        attribute: { attributeName: 'ticket' },
      })

      const { attribute } = await harness.app.attributes.unretire.execute({
        actor: 'human',
        attribute: { attributeName: 'ticket' },
      })

      expect(attribute).toEqual(defined.attribute)
      expect([attribute.type, attribute.retiredAt]).toEqual(['number', undefined])
      await expect(
        harness.app.attributes.unretire.execute({
          actor: 'human',
          attribute: { attributeId: attribute.id },
        }),
      ).rejects.toBeInstanceOf(ConflictError)
    })

    test('announces every act on the outbox, one name per act', async () => {
      await harness.app.attributes.define.execute({
        actor: 'human',
        name: 'ticket',
        type: 'number',
      })
      await harness.app.attributes.rename.execute({
        actor: 'human',
        attribute: { attributeName: 'ticket' },
        name: 'issue',
      })
      await harness.app.attributes.retire.execute({
        actor: 'human',
        attribute: { attributeName: 'issue' },
      })

      await harness.app.attributes.unretire.execute({
        actor: 'human',
        attribute: { attributeName: 'issue' },
      })

      expect(await harness.eventNames()).toEqual([
        'AttributeDefined',
        'AttributeRenamed',
        'AttributeRetired',
        'AttributeUnretired',
      ])
    })
  })

  describe('a value on a record', () => {
    let retroId: number
    let rid: string

    beforeEach(async () => {
      const session = await harness.session()
      const filed = await harness.revision(session.id)
      retroId = filed.retroId
      rid = filed.revision.records[0]?.rid ?? ''
    })

    const define = (name: string, type: 'number' | 'text' | 'url' | 'date') =>
      harness.app.attributes.define.execute({ actor: 'human', name, type })

    const set = (name: string, value?: string) =>
      harness.app.attributes.set.execute({
        actor: 'human',
        retro: { retroId },
        rid,
        attribute: { attributeName: name },
        ...(value === undefined ? {} : { value }),
      })

    const carried = async () =>
      (await harness.app.records.byId.execute({ actor: 'human', id: 1 })).attributes

    test('is set, read back with its name and type, and cleared', async () => {
      await define('external issue id', 'url')

      expect((await set('external issue id', 'https://github.com/o/r/issues/91')).version).toBe(1)
      expect(await carried()).toEqual([
        {
          id: (await carried())[0]?.id ?? 0,
          name: 'external issue id',
          type: 'url',
          value: 'https://github.com/o/r/issues/91',
          retired: false,
        },
      ])

      expect((await set('external issue id')).version).toBe(2)
      expect(await carried()).toEqual([])
    })

    /** Clearing is a row with no value, so the history survives the clear. */
    test('clearing writes a version rather than removing the rows', async () => {
      await define('ticket', 'number')
      await set('ticket', '4192')
      await set('ticket')

      expect(
        (await harness.store.recordAttributeValues.listForRecord(retroId, rid)).map(
          (one) => one.value,
        ),
      ).toEqual(['4192', undefined])
    })

    test('is refused to the AI, whichever way round', async () => {
      await define('ticket', 'number')

      for (const value of ['4192', undefined]) {
        await expect(
          harness.app.attributes.set.execute({
            actor: 'ai',
            retro: { retroId },
            rid,
            attribute: { attributeName: 'ticket' },
            ...(value === undefined ? {} : { value }),
          }),
        ).rejects.toBeInstanceOf(ForbiddenActorError)
      }
    })

    /**
     * **Light validation, per type.** Each rule goes exactly as far as the
     * type's name promises: a number parses, a URL names a web address, a date
     * is a calendar day in ISO form, and text is text.
     */
    describe('light validation, per type', () => {
      const accepted: readonly (readonly ['number' | 'text' | 'url' | 'date', string])[] = [
        ['number', '4192'],
        ['number', '-3.5'],
        // Verbatim after trimming, never canonicalised: nothing does arithmetic
        // on one, and rewriting a human field to taste is what this store never
        // does.
        ['number', '007'],
        ['text', 'moved to the platform board'],
        ['url', 'https://github.com/o/r/issues/91'],
        ['url', 'http://localhost:24300/records/7'],
        ['date', '2026-09-01'],
      ]

      const refused: readonly (readonly ['number' | 'text' | 'url' | 'date', string])[] = [
        ['number', '12abc'],
        ['number', ''],
        ['url', 'github.com/o/r/issues/91'],
        ['url', 'mailto:someone@example.com'],
        ['date', '01/09/2026'],
        /**
         * **The one that convicted the obvious implementation.**
         * `Date.parse('2026-02-31')` is not NaN — V8 rolls it over and answers
         * the 3rd of March — so a regex plus a not-NaN check accepts this and
         * then silently means a different day. The rule round-trips instead
         * (`definition-input.schema.ts` §date), and this row is what fails if
         * anybody simplifies it back.
         */
        ['date', '2026-02-31'],
        ['date', '2026-02-29'],
        ['text', '   '],
        ['text', 'x'.repeat(501)],
      ]

      for (const [type, value] of accepted) {
        test(`accepts ${JSON.stringify(value)} as a ${type}`, async () => {
          await define(type, type)
          expect((await set(type, value)).values[0]?.value).toBe(value.trim())
        })
      }

      for (const [type, value] of refused) {
        test(`refuses ${JSON.stringify(value)} as a ${type}`, async () => {
          await define(type, type)
          await expect(set(type, value)).rejects.toBeInstanceOf(ValidationError)
        })
      }
    })

    /**
     * A value is an assignment rather than a toggle, so re-asserting one is
     * allowed — the same standing `decisions.record` gives a repeated verdict.
     * What is refused is clearing what is not there, which is the act that did
     * nothing.
     */
    test('accepts the same value again, and refuses a clear with nothing to clear', async () => {
      await define('ticket', 'number')

      await set('ticket', '4192')
      expect((await set('ticket', '4192')).version).toBe(2)

      await set('ticket')
      await expect(set('ticket')).rejects.toBeInstanceOf(ConflictError)
    })

    test('cannot be set on a retired attribute, and can still be cleared', async () => {
      await define('ticket', 'number')
      await set('ticket', '4192')
      await harness.app.attributes.retire.execute({
        actor: 'human',
        attribute: { attributeName: 'ticket' },
      })

      await expect(set('ticket', '5000')).rejects.toThrow(/retired/)
      await set('ticket')
      expect(await carried()).toEqual([])
    })

    /** The offering comes back with the attribute, exactly as it does for a label. */
    test('can be set again once the attribute is un-retired', async () => {
      await define('ticket', 'number')
      await harness.app.attributes.retire.execute({
        actor: 'human',
        attribute: { attributeName: 'ticket' },
      })
      await expect(set('ticket', '5000')).rejects.toThrow(/retired/)

      await harness.app.attributes.unretire.execute({
        actor: 'human',
        attribute: { attributeName: 'ticket' },
      })

      await set('ticket', '5000')
      expect((await carried()).map((one) => [one.name, one.value, one.retired])).toEqual([
        ['ticket', '5000', false],
      ])
    })

    test('renders a retired attribute it still carries, marked retired', async () => {
      await define('ticket', 'number')
      await set('ticket', '4192')
      await harness.app.attributes.retire.execute({
        actor: 'human',
        attribute: { attributeName: 'ticket' },
      })

      expect((await carried()).map((one) => [one.name, one.value, one.retired])).toEqual([
        ['ticket', '4192', true],
      ])
    })

    test('is a NotFound for an unknown record or an unknown attribute', async () => {
      await define('ticket', 'number')

      await expect(
        harness.app.attributes.set.execute({
          actor: 'human',
          retro: { retroId },
          rid: 'r-ghost',
          attribute: { attributeName: 'ticket' },
          value: '1',
        }),
      ).rejects.toBeInstanceOf(NotFoundError)
      await expect(
        harness.app.attributes.set.execute({
          actor: 'human',
          retro: { retroId },
          rid,
          attribute: { attributeName: 'nothing' },
          value: '1',
        }),
      ).rejects.toBeInstanceOf(NotFoundError)
    })

    test('announces the act on the record’s own retrospective stream', async () => {
      await define('ticket', 'number')
      await set('ticket', '4192')
      await set('ticket')

      const { events } = await harness.app.events.list.execute({ actor: 'ai', retro: { retroId } })
      expect(
        events
          .filter((event) => event.name.startsWith('RecordAttribute'))
          .map((event) => [event.name, event.rid, event.revisionN]),
      ).toEqual([
        ['RecordAttributeSet', rid, undefined],
        ['RecordAttributeCleared', rid, undefined],
      ])
    })
  })
})
