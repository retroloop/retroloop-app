import { Database } from 'bun:sqlite'
import { afterAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { MIGRATIONS } from '#infrastructure/sqlite/migrations/index'
import { migrate } from '#infrastructure/sqlite/migrator'
import { createTempStage, removeTempStages } from '../support/temp-stage'

afterAll(removeTempStages)

const VERSION = '20260831090000'
const INDEX = MIGRATIONS.findIndex((migration) => migration.version === VERSION)
const MIGRATION = MIGRATIONS[INDEX]

/**
 * The archive rebuild, against a database that already holds lifecycle rows.
 *
 * `migrator.test.ts` runs `up → down → up` over every migration and compares the
 * *schema text*, which answers "does `up` say everything it does". It says
 * nothing about the rows, and a rebuild migration is exactly the kind that can
 * lose them — or lose the triggers that protect them, because `DROP TABLE` takes
 * its triggers with it.
 *
 * The seeded rows are the shape a production store actually holds: entries the
 * AI wrote from the CLI while working a fix queue, with references attached.
 */
function seededDatabaseBeforeTheMigration(): Database {
  const db = new Database(join(createTempStage(), 'retro.db'), { create: true })
  db.run('PRAGMA foreign_keys = ON')
  migrate(db, { registry: MIGRATIONS.slice(0, INDEX) })

  db.exec(`
    INSERT INTO sessions (id, claude_session, project, cwd, branch, supervised, started_at)
      VALUES (1, 'uuid-1', 'retro', '/tmp/retro', 'main', 1, '2026-08-23T09:00:00.000Z');
    INSERT INTO retrospectives (id, session_id, state, started_at, finished_at)
      VALUES (1, 1, 'finished', '2026-08-23T09:00:00.000Z', '2026-08-24T09:00:00.000Z');

    INSERT INTO record_lifecycle (id, retro_id, rid, version, status, refs, note, actor, at)
      VALUES (1, 1, 'r-stale-lock', 1, 'resolved',
              '["a1b2c3d","https://github.com/o/r/pull/42"]', 'Landed on main.', 'ai',
              '2026-08-29T10:00:00.000Z'),
             (2, 1, 'r-stale-lock', 2, 'reopened', '[]', 'It came back.', 'human',
              '2026-08-30T11:00:00.000Z'),
             (3, 1, 'r-silent-tailer', 1, 'resolved', '["deadbee"]', NULL, 'ai',
              '2026-08-30T12:00:00.000Z');
  `)
  return db
}

function rowsOf(db: Database, table: string): unknown[] {
  return db.query<Record<string, unknown>, []>(`SELECT * FROM ${table} ORDER BY id`).all()
}

function triggersOn(db: Database, table: string): string[] {
  return db
    .query<{ name: string }, [string]>(
      `SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ? ORDER BY name`,
    )
    .all(table)
    .map((row) => row.name)
}

function anArchive(rid: string, version: number): string {
  return `INSERT INTO record_lifecycle (retro_id, rid, version, status, refs, note, actor, at)
          VALUES (1, '${rid}', ${version}, 'archived', '[]', NULL, 'human',
                  '2026-08-31T09:00:00.000Z')`
}

describe('record_lifecycle_allow_archive', () => {
  test('is in the registry, after the table it rebuilds', () => {
    expect(MIGRATION?.name).toBe('record_lifecycle_allow_archive')
    const after = (name: string) => MIGRATIONS.findIndex((migration) => migration.name === name)
    expect(INDEX).toBeGreaterThan(after('create_record_lifecycle'))
  })

  /**
   * The red half of the point: before this migration the store refused the
   * value, which is what makes the widening a change rather than a no-op.
   */
  test('the status it admits was refused before it ran', () => {
    const db = seededDatabaseBeforeTheMigration()

    expect(() => db.run(anArchive('r-new', 1))).toThrow(/CHECK/)

    db.close()
  })

  test('carries every entry across the rebuild, refs and all', () => {
    const db = seededDatabaseBeforeTheMigration()
    const before = rowsOf(db, 'record_lifecycle')

    migrate(db, { registry: MIGRATIONS })

    // Byte for byte, including the JSON text of a multi-reference resolve: a
    // rebuild that round-tripped `refs` through anything would show up here.
    expect(rowsOf(db, 'record_lifecycle')).toEqual(before)

    db.close()
  })

  test('admits all four acts afterwards, and still refuses one nobody defined', () => {
    const db = seededDatabaseBeforeTheMigration()
    migrate(db, { registry: MIGRATIONS })

    db.run(anArchive('r-new', 1))
    db.run(
      `INSERT INTO record_lifecycle (retro_id, rid, version, status, refs, note, actor, at)
       VALUES (1, 'r-new', 2, 'unarchived', '[]', NULL, 'human', '2026-08-31T09:05:00.000Z')`,
    )
    // The two acts that were always there stay writable, so a rebuild that
    // reinserts the old rows cannot fail half-way.
    db.run(
      `INSERT INTO record_lifecycle (retro_id, rid, version, status, refs, note, actor, at)
       VALUES (1, 'r-new', 3, 'resolved', '["c0ffee1"]', NULL, 'ai', '2026-08-31T09:06:00.000Z'),
              (1, 'r-new', 4, 'reopened', '[]', NULL, 'human', '2026-08-31T09:07:00.000Z')`,
    )

    expect(() =>
      db.run(
        `INSERT INTO record_lifecycle (retro_id, rid, version, status, refs, note, actor, at)
         VALUES (1, 'r-bad', 1, 'wontfix', '[]', NULL, 'human', '2026-08-31T09:08:00.000Z')`,
      ),
    ).toThrow(/CHECK/)

    db.close()
  })

  test('puts the triggers back — no schema version leaves the table unprotected', () => {
    const db = seededDatabaseBeforeTheMigration()
    migrate(db, { registry: MIGRATIONS })

    expect(triggersOn(db, 'record_lifecycle')).toEqual([
      'record_lifecycle_no_delete',
      'record_lifecycle_no_update',
    ])
    expect(() => db.run("UPDATE record_lifecycle SET status = 'archived' WHERE id = 1")).toThrow(
      /append-only/,
    )
    expect(() => db.run('DELETE FROM record_lifecycle WHERE id = 1')).toThrow(/never deleted/)

    db.close()
  })

  /**
   * **Nothing is backfilled**, because a declined record reads as archived by
   * derivation. A migration that had written rows would have had to invent an
   * actor and a moment for a decision somebody else made — and would have taken
   * the derivation's answer away from every store closed before it ran.
   */
  test('writes no rows of its own', () => {
    const db = seededDatabaseBeforeTheMigration()
    const before = db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM record_lifecycle').get()

    migrate(db, { registry: MIGRATIONS })

    expect(db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM record_lifecycle').get()).toEqual(
      before as { n: number },
    )

    db.close()
  })
})
