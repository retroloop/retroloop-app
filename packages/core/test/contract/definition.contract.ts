import { beforeEach, describe, expect, test } from 'bun:test'
import type { Store } from '#application/ports/store.port'
import { NoSuchDefinitionError } from '#infrastructure/no-such-definition'
import type { StoreFactory } from './store.contract'

/**
 * The two definition repositories, against every adapter (testing.md suite 1).
 *
 * **One file for both, and that is not the two primitives being coupled.**
 * The design ruling is about semantics — labels classify, attributes carry data,
 * and the system enforces no pairing between them — and nothing here pairs
 * anything: the two suites below never touch the same table. What they share is
 * a *shape*, because a definition is a definition, and the shape is the thing
 * that has to behave identically in both stores.
 *
 * These are the only repositories in the system that write over a stored row,
 * so this is the one contract suite whose subject is a mutation. Four
 * properties matter and none of them is expressible as a type: a rename changes
 * the name and nothing else, a retire stamps a timestamp and removes nothing, an
 * un-retire clears that stamp and touches nothing else, and every one of them
 * answers with the row the database now holds rather than with what the caller
 * passed in.
 *
 * **The un-retire cases are here rather than only in the use case** because the
 * two stores clear the column two different ways — SQLite writes `NULL` and the
 * memory adapter writes `undefined` — and "still offered" has to read identical
 * out of both or `isOfferable` means one thing in a suite and another in
 * production.
 *
 * **The tables' own constraints are not asserted here.** A UNIQUE name and a
 * CHECKed type are L1 backstops that only SQLite has — the memory adapter is
 * arrays and enforces none of them, exactly as it enforces no foreign key — and
 * a shared suite is only worth what both adapters actually pass. They live in
 * `test/sqlite/definition-constraints.test.ts`, beside the trigger tests, which
 * is where every other L1-only guarantee in this repo is proven.
 */
export function describeDefinitionRepositoryContract(label: string, makeStore: StoreFactory): void {
  describe(`${label} · LabelDefinitionRepository`, () => {
    let store: Store

    beforeEach(async () => {
      store = await makeStore()
    })

    const define = (name: string, createdAt = '2026-09-01T09:00:00.000Z') =>
      store.labelDefinitions.add({ name, retiredAt: undefined, createdAt })

    /**
     * **The product ships none**, which is a property of the store rather than
     * of a fixture: no migration inserts a row and nothing defaults one
     * (`20260901090000_create_label_definitions.ts`).
     */
    test('is empty on a store nobody has configured', async () => {
      expect(await store.labelDefinitions.listAll()).toEqual([])
    })

    test('stores a definition and reads it back by id', async () => {
      const label = await define('migrated')

      expect(await store.labelDefinitions.findById(label.id)).toEqual(label)
      expect([label.name, label.retiredAt, label.createdAt]).toEqual([
        'migrated',
        undefined,
        '2026-09-01T09:00:00.000Z',
      ])
    })

    test('returns undefined for an id nothing answers to', async () => {
      expect(await store.labelDefinitions.findById(404)).toBeUndefined()
    })

    /** Minting order — the one order both stores answer without choosing a collation. */
    test('lists every definition in minting order, retired ones included', async () => {
      const first = await define('migrated')
      const second = await define('needs-triage')
      await store.labelDefinitions.retire(first.id, '2026-09-02T09:00:00.000Z')

      expect((await store.labelDefinitions.listAll()).map((one) => one.id)).toEqual([
        first.id,
        second.id,
      ])
    })

    /**
     * A rename really writes over the row — which is what makes every record
     * wearing the label read the new name at once, and what separates a
     * definition from human data (`label-definition.repository.ts`).
     */
    test('renames in place, touching nothing else', async () => {
      const label = await define('migratd')

      const renamed = await store.labelDefinitions.rename(label.id, 'migrated')

      expect(renamed).toEqual({ ...label, name: 'migrated' })
      expect(await store.labelDefinitions.findById(label.id)).toEqual(renamed)
      expect(await store.labelDefinitions.listAll()).toHaveLength(1)
    })

    /** Retiring stamps a time and removes nothing: the row is what keeps the name readable. */
    test('retires in place, and the row stays', async () => {
      const label = await define('migrated')

      const retired = await store.labelDefinitions.retire(label.id, '2026-09-02T09:00:00.000Z')

      expect(retired).toEqual({ ...label, retiredAt: '2026-09-02T09:00:00.000Z' })
      expect(await store.labelDefinitions.listAll()).toEqual([retired])
    })

    /**
     * **Back to exactly what it was**, field for field — which is the property
     * that makes a mis-press a two-press round trip rather than a repair: the
     * id, the name and the creation time are the ones the row was minted with,
     * and `retiredAt` is `undefined` rather than an empty string or a null that
     * `isOfferable` would read as still-retired.
     */
    test('un-retires in place, and the row is the row it was before the retire', async () => {
      const label = await define('migrated')
      await store.labelDefinitions.retire(label.id, '2026-09-02T09:00:00.000Z')

      const restored = await store.labelDefinitions.unretire(label.id)

      expect(restored).toEqual(label)
      expect(restored.retiredAt).toBeUndefined()
      expect(await store.labelDefinitions.findById(label.id)).toEqual(restored)
      expect(await store.labelDefinitions.listAll()).toHaveLength(1)
    })

    /** The name is the label's, and a round trip through retirement never touched it. */
    test('keeps a rename made while it was retired', async () => {
      const label = await define('migratd')
      await store.labelDefinitions.retire(label.id, '2026-09-02T09:00:00.000Z')
      await store.labelDefinitions.rename(label.id, 'migrated')

      const restored = await store.labelDefinitions.unretire(label.id)

      expect([restored.name, restored.retiredAt]).toEqual(['migrated', undefined])
    })

    test('keeps the name through a retire, and the retirement through a rename', async () => {
      const label = await define('migratd')
      await store.labelDefinitions.retire(label.id, '2026-09-02T09:00:00.000Z')

      const renamed = await store.labelDefinitions.rename(label.id, 'migrated')

      expect([renamed.name, renamed.retiredAt]).toEqual(['migrated', '2026-09-02T09:00:00.000Z'])
    })

    /**
     * **Both stores shout on the same condition**, which is the whole reason
     * this is in a contract suite: SQLite's `UPDATE … WHERE id = ?` matching
     * nothing is not an error, so without the read-back the two adapters would
     * differ — memory throwing and SQLite quietly answering with a row that is
     * not there (`no-such-definition.ts`).
     */
    test('shouts when the row it was told to write to is not there', async () => {
      for (const write of [
        () => store.labelDefinitions.rename(404, 'ghost'),
        () => store.labelDefinitions.retire(404, '2026-09-02T09:00:00.000Z'),
        () => store.labelDefinitions.unretire(404),
      ]) {
        await expect(write()).rejects.toBeInstanceOf(NoSuchDefinitionError)
      }
    })
  })

  describe(`${label} · AttributeDefinitionRepository`, () => {
    let store: Store

    beforeEach(async () => {
      store = await makeStore()
    })

    const define = (name: string, type: 'number' | 'text' | 'url' | 'date') =>
      store.attributeDefinitions.add({
        name,
        type,
        retiredAt: undefined,
        createdAt: '2026-09-01T09:00:00.000Z',
      })

    test('is empty on a store nobody has configured', async () => {
      expect(await store.attributeDefinitions.listAll()).toEqual([])
    })

    /**
     * Every type round-trips. SQLite stores the word in a CHECKed TEXT column
     * and the domain narrows it back on the way out (`rows.ts` §checked), so a
     * type that came back as a bare string would be a type the compiler believed
     * and the store did not.
     */
    test('keeps every type it was given, both ways', async () => {
      for (const type of ['number', 'text', 'url', 'date'] as const) {
        const attribute = await define(type, type)
        expect((await store.attributeDefinitions.findById(attribute.id))?.type).toBe(type)
      }
    })

    /** A rename never touches the type — there is no path in the system that does. */
    test('renames in place and keeps the type', async () => {
      const attribute = await define('ticket', 'number')

      const renamed = await store.attributeDefinitions.rename(attribute.id, 'external ticket ID')

      expect(renamed).toEqual({ ...attribute, name: 'external ticket ID' })
    })

    test('retires in place, and the row stays', async () => {
      const attribute = await define('ticket', 'number')

      const retired = await store.attributeDefinitions.retire(
        attribute.id,
        '2026-09-02T09:00:00.000Z',
      )

      expect(retired.retiredAt).toBe('2026-09-02T09:00:00.000Z')
      expect(await store.attributeDefinitions.listAll()).toEqual([retired])
    })

    /** The type survives the round trip — there is no path in this system that changes one. */
    test('un-retires in place, keeping the type', async () => {
      const attribute = await define('ticket', 'number')
      await store.attributeDefinitions.retire(attribute.id, '2026-09-02T09:00:00.000Z')

      const restored = await store.attributeDefinitions.unretire(attribute.id)

      expect(restored).toEqual(attribute)
      expect([restored.type, restored.retiredAt]).toEqual(['number', undefined])
    })

    test('shouts when the row it was told to write to is not there', async () => {
      await expect(store.attributeDefinitions.rename(404, 'ghost')).rejects.toBeInstanceOf(
        NoSuchDefinitionError,
      )
      await expect(store.attributeDefinitions.unretire(404)).rejects.toBeInstanceOf(
        NoSuchDefinitionError,
      )
    })

    /**
     * The two vocabularies are separate tables, so the same name in each is two
     * definitions — the ruling that the primitives are independent, at L1.
     */
    test('does not collide with a label of the same name', async () => {
      await store.labelDefinitions.add({
        name: 'migrated',
        retiredAt: undefined,
        createdAt: '2026-09-01T09:00:00.000Z',
      })

      const attribute = await define('migrated', 'date')

      expect(attribute.name).toBe('migrated')
    })
  })
}
