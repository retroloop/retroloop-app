import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import type { SqliteStore } from '#infrastructure/sqlite/sqlite-store.adapter'
import { openTempStore, removeTempStages } from '../support/temp-stage'

afterAll(removeTempStages)

/**
 * The L1 backstops the two vocabularies and the settings table carry — the
 * constraints, as opposed to the triggers next door.
 *
 * They are here rather than in the shared contract suite because **only SQLite
 * has them**: the memory adapter is arrays, and it enforces a UNIQUE name as
 * little as it enforces a foreign key. A shared contract is worth exactly what
 * both adapters pass, so a check one of them cannot make belongs beside the
 * trigger tests, which is where every other L1-only guarantee in this repo is
 * proven.
 *
 * None of these is the rule the product enforces. Uniqueness is
 * case-**insensitive** and lives in the use cases so both stores answer it
 * identically (`definition.service.ts`); the type and key enums are closed by
 * the owner's ruling and by zod at the boundary. What is asserted here is that a
 * writer who came through none of that still cannot leave the store in a state
 * a reader would have to cope with.
 */
describe('definition and settings constraints', () => {
  let store: SqliteStore

  beforeEach(() => {
    store = openTempStore()
  })

  const label = (name: string) =>
    store.labelDefinitions.add({
      name,
      retiredAt: undefined,
      createdAt: '2026-09-01T09:00:00.000Z',
    })

  test('a label name is unique', async () => {
    await label('migrated')

    await expect(label('migrated')).rejects.toThrow(/UNIQUE/)
  })

  /**
   * Case-sensitively, which is the deliberate half of the split: the product's
   * rule folds case and this constraint does not, so `Migrated` gets past here
   * and is refused one layer up. The backstop is for a writer that bypassed the
   * use case entirely, and catching the exact duplicate is what it is for.
   */
  test('and only exactly — the case-folding rule is the use case’s', async () => {
    await label('migrated')

    await expect(label('Migrated')).resolves.toBeDefined()
  })

  test('an attribute name is unique, and its type must be one of the four', async () => {
    const define = (name: string, type: string) =>
      store.attributeDefinitions.add({
        name,
        type: type as never,
        retiredAt: undefined,
        createdAt: '2026-09-01T09:00:00.000Z',
      })

    await define('ticket', 'number')

    await expect(define('ticket', 'text')).rejects.toThrow(/UNIQUE/)
    await expect(define('flagged', 'boolean')).rejects.toThrow(/CHECK/)
  })

  /**
   * A record label points at a definition that exists, and an attribute value
   * likewise. `PRAGMA foreign_keys = ON` is what makes the join in
   * `definition.view.ts` safe enough to shout on a miss rather than render a
   * blank tag.
   */
  test('a record label and an attribute value must point at a definition that exists', async () => {
    const session = await store.sessions.add({
      claudeSession: 'uuid-1',
      project: 'retro',
      cwd: '/tmp',
      branch: 'main',
      supervised: true,
      startedAt: '2026-08-23T09:00:00.000Z',
    })
    const retro = await store.retrospectives.add({
      sessionId: session.id,
      state: 'reviewing',
      startedAt: '2026-08-23T09:00:00.000Z',
      finishedAt: undefined,
    })

    await expect(
      store.recordLabels.add({
        retroId: retro.id,
        rid: 'r-stale-lock',
        labelId: 404,
        version: 1,
        applied: true,
        at: '2026-09-01T10:00:00.000Z',
      }),
    ).rejects.toThrow(/FOREIGN KEY/)
    await expect(
      store.recordAttributeValues.add({
        retroId: retro.id,
        rid: 'r-stale-lock',
        attributeId: 404,
        version: 1,
        value: '4192',
        at: '2026-09-01T10:00:00.000Z',
      }),
    ).rejects.toThrow(/FOREIGN KEY/)
  })

  /**
   * The settings table's own two: a key nobody declared is a key nothing reads
   * and nothing can default, and one version per key is what makes "the highest
   * version is the one in force" a fact rather than a hope.
   */
  test('a setting key is one of the declared ones, and a version happens once', async () => {
    const entry = {
      key: 'ai_config_write' as const,
      version: 1,
      value: 'on',
      at: '2026-09-01T09:00:00.000Z',
    }
    await store.settings.add(entry)

    await expect(store.settings.add(entry)).rejects.toThrow(/UNIQUE/)
    await expect(store.settings.add({ ...entry, key: 'made_up' as never })).rejects.toThrow(/CHECK/)
    await expect(store.settings.add({ ...entry, version: 0 })).rejects.toThrow(/CHECK/)
  })

  /**
   * A record label's version happens once per `(record, label)` — which is what
   * lets three labels on one record hold three independent `version: 1` rows,
   * the property the contract suite is built around.
   */
  test('a record label version happens once per record and label, and not more widely', async () => {
    const session = await store.sessions.add({
      claudeSession: 'uuid-2',
      project: 'retro',
      cwd: '/tmp',
      branch: 'main',
      supervised: true,
      startedAt: '2026-08-23T09:00:00.000Z',
    })
    const retro = await store.retrospectives.add({
      sessionId: session.id,
      state: 'reviewing',
      startedAt: '2026-08-23T09:00:00.000Z',
      finishedAt: undefined,
    })
    const migrated = await label('migrated')
    const triage = await label('needs-triage')
    const entry = {
      retroId: retro.id,
      rid: 'r-stale-lock',
      labelId: migrated.id,
      version: 1,
      applied: true,
      at: '2026-09-01T10:00:00.000Z',
    }
    await store.recordLabels.add(entry)

    // The same label again at v1 is a duplicate; a different label at v1 is not.
    await expect(store.recordLabels.add(entry)).rejects.toThrow(/UNIQUE/)
    await expect(store.recordLabels.add({ ...entry, labelId: triage.id })).resolves.toBeDefined()
  })
})
