import { Database } from 'bun:sqlite'
import { afterAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { LEDGER_TABLE } from '#infrastructure/sqlite/migration'
import { MIGRATIONS } from '#infrastructure/sqlite/migrations/index'
import { migrate } from '#infrastructure/sqlite/migrator'
import { createTempStage, removeTempStages } from '../support/temp-stage'

afterAll(removeTempStages)

const VERSION = '20260830090000'
const INDEX = MIGRATIONS.findIndex((migration) => migration.version === VERSION)
const MIGRATION = MIGRATIONS[INDEX]

/**
 * The backfill, against a store that already holds records.
 *
 * `migrator.test.ts` runs `up → down → up` over every migration and compares the
 * schema text, which says nothing about rows — and this migration is almost
 * entirely rows. What it does is **assign identity**, in one order, once; the
 * order is not recoverable from anything else afterwards, so it is read back
 * here rather than trusted.
 */
function record(rid: string, num: number): string {
  // Only the two fields the backfill reads. A record's blob carries a dozen more
  // and none of them decide a number, which is the point of taking the identity
  // out of the narrative in the first place.
  return JSON.stringify({ rid, num, title: `record ${num}` })
}

function records(...entries: readonly (readonly [string, number])[]): string {
  return `[${entries.map(([rid, num]) => record(rid, num)).join(',')}]`
}

/**
 * Two sessions, three retrospectives, seven records, and one of them withdrawn
 * by a later draft — the fixture production data is a bigger version of, plus
 * the one case it does not have.
 */
function seededDatabaseBeforeTheMigration(): Database {
  const db = new Database(join(createTempStage(), 'retro.db'), { create: true })
  db.run('PRAGMA foreign_keys = ON')
  migrate(db, { registry: MIGRATIONS.slice(0, INDEX) })

  db.exec(`
    INSERT INTO sessions (id, claude_session, project, cwd, branch, supervised, started_at)
      VALUES (1, 'uuid-1', 'retro', '/Users/sample/Developer/retro', 'main', 1,
              '2026-08-23T09:00:00.000Z'),
             (2, 'uuid-2', NULL, '/Users/sample/Developer/hangar', 'main', 1,
              '2026-08-24T09:00:00.000Z');
    INSERT INTO retrospectives (id, session_id, state, started_at, finished_at)
      VALUES (1, 1, 'finished',  '2026-08-23T09:00:00.000Z', '2026-08-23T18:00:00.000Z'),
             (2, 2, 'finished',  '2026-08-24T09:00:00.000Z', '2026-08-24T18:00:00.000Z'),
             (3, 1, 'reviewing', '2026-08-25T09:00:00.000Z', NULL);

    INSERT INTO revisions (retro_id, n, created_at, records) VALUES
      (1, 1, '2026-08-23T10:00:00.000Z',
       '${records(['r-stale-lock', 1], ['r-prose-raw', 2])}'),
      (2, 1, '2026-08-24T10:00:00.000Z',
       '${records(['r-stale-lock', 1])}'),
      -- Retro 3 goes three rounds: two records, then a third, then the third is
      -- withdrawn again. Density is per rid, so this is a draft the write path
      -- accepts -- see checkIdentityStability in create-revision.use-case.ts.
      (3, 1, '2026-08-25T10:00:00.000Z',
       '${records(['r-flaky-landing', 1], ['r-ipad-scroll', 2])}'),
      (3, 2, '2026-08-25T12:00:00.000Z',
       '${records(['r-flaky-landing', 1], ['r-ipad-scroll', 2], ['r-doctor-blind', 3])}'),
      (3, 3, '2026-08-25T14:00:00.000Z',
       '${records(['r-flaky-landing', 1], ['r-ipad-scroll', 2])}');
  `)
  return db
}

function mintedIds(db: Database): (readonly [number, number, string])[] {
  return db
    .query<{ id: number; retro_id: number; rid: string }, []>(
      'SELECT id, retro_id, rid FROM record_ids ORDER BY id',
    )
    .all()
    .map((row) => [row.id, row.retro_id, row.rid] as const)
}

function triggersOn(db: Database, table: string): string[] {
  return db
    .query<{ name: string }, [string]>(
      `SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ? ORDER BY name`,
    )
    .all(table)
    .map((row) => row.name)
}

describe('create_record_ids', () => {
  test('is in the registry, after the table it reads', () => {
    expect(MIGRATION?.name).toBe('create_record_ids')
    const after = (name: string) => MIGRATIONS.findIndex((migration) => migration.name === name)
    expect(INDEX).toBeGreaterThan(after('create_retrospectives'))
    expect(INDEX).toBeGreaterThan(after('create_revisions'))
  })

  /**
   * The whole migration, in one assertion: **retrospective by id, then `num`**.
   *
   * Every pairing here disagrees with a wrong reading. Retro 2's only record is
   * `num` 1 and gets 3, so a per-retro counter is out. `r-stale-lock` is minted
   * twice for two different numbers, so keying on the rid alone is out. And
   * `r-doctor-blind` has a number at all, though the latest draft of its
   * retrospective does not mention it — so a backfill that read only the latest
   * revision comes up one short.
   */
  test('numbers every record ever filed, oldest retrospective first, in reading order', () => {
    const db = seededDatabaseBeforeTheMigration()
    migrate(db, { registry: MIGRATIONS })

    expect(mintedIds(db)).toEqual([
      [1, 1, 'r-stale-lock'],
      [2, 1, 'r-prose-raw'],
      [3, 2, 'r-stale-lock'],
      [4, 3, 'r-flaky-landing'],
      [5, 3, 'r-ipad-scroll'],
      [6, 3, 'r-doctor-blind'],
    ])

    db.close()
  })

  /**
   * A record the AI withdrew in a later draft still has a number, and it is the
   * number its first appearance earned rather than one appended at the end.
   *
   * This is the case that separates this backfill from the narrower reading of
   * it — "the latest revision's records" — which would leave `r-doctor-blind`
   * with no number at all while `records.list --revision 2` still lists it. In
   * the common case, where nothing was ever withdrawn, the two readings agree;
   * the reason to choose this one is the shape where they do not.
   */
  test('numbers a record a later draft withdrew, in the place it first appeared', () => {
    const db = seededDatabaseBeforeTheMigration()
    migrate(db, { registry: MIGRATIONS })

    const withdrawn = mintedIds(db).find(([, , rid]) => rid === 'r-doctor-blind')
    expect(withdrawn).toEqual([6, 3, 'r-doctor-blind'])
    // And it is genuinely absent from the latest draft, so the fixture is
    // testing what it claims to.
    expect(
      db
        .query<{ total: number }, []>(
          `SELECT COUNT(*) AS total FROM revisions r, json_each(r.records) rec
            WHERE r.retro_id = 3 AND r.n = 3
              AND json_extract(rec.value, '$.rid') = 'r-doctor-blind'`,
        )
        .get()?.total,
    ).toBe(0)

    db.close()
  })

  /**
   * The invariant the order rests on, stated as a refusal rather than assumed.
   *
   * `num` order is first-appearance order **because** a retrospective's numbers
   * stay dense and are never renumbered, so a later draft can only add above what
   * is spoken for (`checkIdentityStability`). A blob where a rid carries two
   * different `num`s is a store where that broke — and the migration refuses it
   * outright rather than quietly picking one of the two, because the number it
   * would be picking is the identity of the record.
   */
  test('refuses a store where one record carries two different numbers', () => {
    const db = seededDatabaseBeforeTheMigration()
    db.exec(`
      INSERT INTO revisions (retro_id, n, created_at, records) VALUES
        (2, 2, '2026-08-24T12:00:00.000Z', '${records(['r-stale-lock', 2])}');
    `)

    expect(() => migrate(db, { registry: MIGRATIONS })).toThrow(/UNIQUE/)
    // And it left nothing behind: DDL is transactional, so the table is not
    // there half-filled (migrations.md).
    expect(
      db
        .query<{ total: number }, []>(
          "SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'table' AND name = 'record_ids'",
        )
        .get()?.total,
    ).toBe(0)

    db.close()
  })

  test('an empty store migrates to an empty sequence', () => {
    const db = new Database(join(createTempStage(), 'retro.db'), { create: true })
    db.run('PRAGMA foreign_keys = ON')
    migrate(db, { registry: MIGRATIONS })

    expect(mintedIds(db)).toEqual([])
    // And the sequence still opens at 1 for the first record ever filed.
    db.exec(`
      INSERT INTO sessions (id, claude_session, project, cwd, branch, supervised, started_at)
        VALUES (1, 'uuid-1', NULL, '/tmp/retro', NULL, 1, '2026-08-26T09:00:00.000Z');
      INSERT INTO retrospectives (id, session_id, state, started_at, finished_at)
        VALUES (1, 1, 'reviewing', '2026-08-26T09:00:00.000Z', NULL);
      INSERT INTO record_ids (retro_id, rid) VALUES (1, 'r-first');
    `)
    expect(mintedIds(db)).toEqual([[1, 1, 'r-first']])

    db.close()
  })

  test('a number is minted once: the same record cannot get a second', () => {
    const db = seededDatabaseBeforeTheMigration()
    migrate(db, { registry: MIGRATIONS })

    expect(() =>
      db.run("INSERT INTO record_ids (retro_id, rid) VALUES (1, 'r-stale-lock')"),
    ).toThrow(/UNIQUE/)
    // The same rid in a retrospective that has not minted it is a different
    // record, and is admitted.
    db.run("INSERT INTO record_ids (retro_id, rid) VALUES (2, 'r-prose-raw')")
    expect(mintedIds(db).at(-1)).toEqual([7, 2, 'r-prose-raw'])

    db.close()
  })

  test('a number never moves: the table is insert-only, whoever asks', () => {
    const db = seededDatabaseBeforeTheMigration()
    migrate(db, { registry: MIGRATIONS })

    expect(triggersOn(db, 'record_ids')).toEqual(['record_ids_no_delete', 'record_ids_no_update'])
    expect(() => db.run('UPDATE record_ids SET rid = ? WHERE id = 1', ['r-renamed'])).toThrow(
      /append-only/,
    )
    expect(() => db.run('DELETE FROM record_ids WHERE id = 1')).toThrow(/never deleted/)

    db.close()
  })

  test('the ledger records it once, and a second migrate finds nothing to do', () => {
    const db = seededDatabaseBeforeTheMigration()

    expect(migrate(db, { registry: MIGRATIONS }).applied).toContain(VERSION)
    expect(migrate(db, { registry: MIGRATIONS }).applied).toEqual([])
    expect(
      db
        .query<{ total: number }, [string]>(
          `SELECT COUNT(*) AS total FROM ${LEDGER_TABLE} WHERE version = ?`,
        )
        .get(VERSION)?.total,
    ).toBe(1)
    // Migrated once means backfilled once: a second run that re-inserted would
    // trip the unique constraint, and one that appended would double the store.
    expect(mintedIds(db)).toHaveLength(6)

    db.close()
  })

  /**
   * **The records themselves are untouched, byte for byte.**
   *
   * This is the invariant the whole design turns on: the number lives outside
   * the blob so that `revision get --content` keeps handing back exactly the
   * draft that was submitted, and so that no decision's carry-over hash moves
   * under it (`content-hash.service.ts`). A migration that had written the
   * number into the JSON would pass every other test in this file.
   */
  test('leaves every stored revision exactly as it found it', () => {
    const db = seededDatabaseBeforeTheMigration()
    const before = db
      .query<{ retro_id: number; n: number; records: string }, []>(
        'SELECT retro_id, n, records FROM revisions ORDER BY retro_id, n',
      )
      .all()

    migrate(db, { registry: MIGRATIONS })

    expect(
      db
        .query<{ retro_id: number; n: number; records: string }, []>(
          'SELECT retro_id, n, records FROM revisions ORDER BY retro_id, n',
        )
        .all(),
    ).toEqual(before)
    expect(before.some((row) => row.records.includes('globalId'))).toBe(false)

    db.close()
  })
})
