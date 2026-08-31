import { Database } from 'bun:sqlite'
import { afterAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { LEDGER_TABLE } from '#infrastructure/sqlite/migration'
import { MIGRATIONS } from '#infrastructure/sqlite/migrations/index'
import { migrate } from '#infrastructure/sqlite/migrator'
import { createTempStage, removeTempStages } from '../support/temp-stage'

afterAll(removeTempStages)

const VERSION = '20260828090000'
const INDEX = MIGRATIONS.findIndex((migration) => migration.version === VERSION)
const MIGRATION = MIGRATIONS[INDEX]

/**
 * The rebuild migration, against a database that already has rows in both
 * tables it rebuilds.
 *
 * `migrator.test.ts` runs `up → down → up` over every migration and compares the
 * *schema text*, which is the right check for "does `up` say everything it
 * does". It says nothing about the rows, and a rebuild migration is exactly the
 * kind that can lose them — or lose the triggers that protect them, because
 * `DROP TABLE` takes its triggers with it.
 */
function seededDatabaseBeforeTheMigration(): Database {
  const db = new Database(join(createTempStage(), 'retro.db'), { create: true })
  db.run('PRAGMA foreign_keys = ON')
  migrate(db, { registry: MIGRATIONS.slice(0, INDEX) })

  db.exec(`
    INSERT INTO sessions (id, claude_session, project, cwd, branch, supervised, started_at)
      VALUES (1, 'uuid-1', 'retro', '/tmp/retro', 'main', 1, '2026-08-23T09:00:00.000Z');
    INSERT INTO retrospectives (id, session_id, state, started_at, finished_at)
      VALUES (1, 1, 'reviewing', '2026-08-23T09:00:00.000Z', NULL);

    INSERT INTO comment_threads (id, retro_id, rid, section, opened_at)
      VALUES (1, 1, 'r-falsifiability-paid', 'direction', '2026-08-23T10:00:00.000Z'),
             (2, 1, 'r-falsifiability-paid', 'footprint', '2026-08-23T10:05:00.000Z'),
             (3, 1, NULL, NULL, '2026-08-23T10:10:00.000Z');
    INSERT INTO comments (id, thread_id, actor, text, at, revision_n)
      VALUES (1, 1, 'human', 'Say who is behind this.', '2026-08-23T10:01:00.000Z', 1),
             (2, 2, 'human', 'The tree is missing lib/lock.ts.', '2026-08-23T10:06:00.000Z', 1);
    INSERT INTO thread_resolutions (id, thread_id, version, resolved, at)
      VALUES (1, 1, 1, 1, '2026-08-23T10:20:00.000Z');

    INSERT INTO decisions (id, retro_id, rid, version, state, severity, solution_level,
                           involvement, reviewer_note, revision_n, content_hash, decided_at)
      VALUES (1, 1, 'r-falsifiability-paid', 1, 'approved', 5, '1', 'autonomous',
              'Your approval makes it law.', 1,
              '7922f606db18f6be6b3b4bc2ba5afe8c2cd30201736621fe5537002e18d0d03b',
              '2026-08-23T20:54:00.000Z'),
             (2, 1, 'r-remove-hold', 1, 'approved', 2, 'upstream', 'pull-request',
              NULL, 1, 'whatever-it-was', '2026-08-23T20:55:00.000Z');
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

describe('solutions_anchor_and_selection', () => {
  test('is in the registry, after everything it depends on', () => {
    expect(MIGRATION?.name).toBe('solutions_anchor_and_selection')
    // It rebuilds `comment_threads` and `decisions`, so it must run after both
    // are created and after every migration that has already touched them.
    // Asserting it is *last* would be a claim about the next feature rather than
    // about this one, and it broke the first time a table was added after it.
    const after = (name: string) => MIGRATIONS.findIndex((migration) => migration.name === name)
    expect(INDEX).toBeGreaterThan(after('create_comment_threads'))
    expect(INDEX).toBeGreaterThan(after('create_decisions'))
    expect(INDEX).toBeGreaterThan(after('comments_add_revision'))
    expect(INDEX).toBeGreaterThan(after('create_thread_resolutions'))
  })

  test('the section it adds was refused before it ran', () => {
    const db = seededDatabaseBeforeTheMigration()

    expect(() =>
      db.run(
        `INSERT INTO comment_threads (retro_id, rid, section, opened_at)
         VALUES (1, 'r-new', 'solutions', '2026-08-24T09:00:00.000Z')`,
      ),
    ).toThrow(/CHECK/)

    db.close()
  })

  test('carries every thread, comment, resolution and decision across the rebuild', () => {
    const db = seededDatabaseBeforeTheMigration()
    const threadsBefore = rowsOf(db, 'comment_threads')
    const commentsBefore = rowsOf(db, 'comments')
    const resolutionsBefore = rowsOf(db, 'thread_resolutions')

    migrate(db, { registry: MIGRATIONS })

    expect(rowsOf(db, 'comment_threads')).toEqual(threadsBefore)
    expect(rowsOf(db, 'comments')).toEqual(commentsBefore)
    expect(rowsOf(db, 'thread_resolutions')).toEqual(resolutionsBefore)
    // Decisions gain the one new column and nothing else moves — including the
    // `upstream` level KC-0021 cut, which no write path could put back.
    expect(rowsOf(db, 'decisions')).toEqual([
      {
        id: 1,
        retro_id: 1,
        rid: 'r-falsifiability-paid',
        version: 1,
        state: 'approved',
        severity: 5,
        solution_level: '1',
        selected_solution: null,
        involvement: 'autonomous',
        reviewer_note: 'Your approval makes it law.',
        revision_n: 1,
        content_hash: '7922f606db18f6be6b3b4bc2ba5afe8c2cd30201736621fe5537002e18d0d03b',
        decided_at: '2026-08-23T20:54:00.000Z',
      },
      {
        id: 2,
        retro_id: 1,
        rid: 'r-remove-hold',
        version: 1,
        state: 'approved',
        severity: 2,
        solution_level: 'upstream',
        selected_solution: null,
        involvement: 'pull-request',
        reviewer_note: null,
        revision_n: 1,
        content_hash: 'whatever-it-was',
        decided_at: '2026-08-23T20:55:00.000Z',
      },
    ])

    db.close()
  })

  test('leaves the legacy anchors usable and admits the new one', () => {
    const db = seededDatabaseBeforeTheMigration()
    migrate(db, { registry: MIGRATIONS })

    db.run(
      `INSERT INTO comment_threads (retro_id, rid, section, opened_at)
       VALUES (1, 'r-new', 'solutions', '2026-08-24T09:00:00.000Z')`,
    )
    // The two the owner's store already anchors threads to: still writable, so a
    // rebuild that reinserts them cannot fail half-way, and still readable.
    db.run(
      `INSERT INTO comment_threads (retro_id, rid, section, opened_at)
       VALUES (1, 'r-old', 'direction', '2026-08-24T09:01:00.000Z'),
              (1, 'r-old', 'footprint', '2026-08-24T09:02:00.000Z')`,
    )
    expect(() =>
      db.run(
        `INSERT INTO comment_threads (retro_id, rid, section, opened_at)
         VALUES (1, 'r-bad', 'proposals', '2026-08-24T09:03:00.000Z')`,
      ),
    ).toThrow(/CHECK/)

    db.close()
  })

  test('puts the decisions triggers back — no schema version leaves the table unprotected', () => {
    const db = seededDatabaseBeforeTheMigration()
    migrate(db, { registry: MIGRATIONS })

    expect(triggersOn(db, 'decisions')).toEqual(['decisions_no_delete', 'decisions_no_update'])
    expect(() => db.run("UPDATE decisions SET state = 'declined' WHERE id = 1")).toThrow(
      /append-only/,
    )
    expect(() => db.run('DELETE FROM decisions WHERE id = 1')).toThrow(/never deleted/)
    expect(triggersOn(db, 'thread_resolutions')).toEqual([
      'thread_resolutions_no_delete',
      'thread_resolutions_no_update',
    ])

    db.close()
  })

  test('takes a selection, and refuses one that is not a position', () => {
    const db = seededDatabaseBeforeTheMigration()
    migrate(db, { registry: MIGRATIONS })

    db.run(
      `INSERT INTO decisions (retro_id, rid, version, state, severity, solution_level,
                              selected_solution, involvement, reviewer_note, revision_n,
                              content_hash, decided_at)
       VALUES (1, 'r-picked', 1, 'approved', 3, '2', 2, 'pull-request', NULL, 1, 'h',
               '2026-08-24T09:00:00.000Z')`,
    )
    expect(
      db
        .query<{ selected_solution: number }, []>(
          "SELECT selected_solution FROM decisions WHERE rid = 'r-picked'",
        )
        .get()?.selected_solution,
    ).toBe(2)

    expect(() =>
      db.run(
        `INSERT INTO decisions (retro_id, rid, version, state, severity, solution_level,
                                selected_solution, involvement, reviewer_note, revision_n,
                                content_hash, decided_at)
         VALUES (1, 'r-zero', 1, 'approved', 3, '2', 0, 'pull-request', NULL, 1, 'h',
                 '2026-08-24T09:00:00.000Z')`,
      ),
    ).toThrow(/CHECK/)

    db.close()
  })

  test('the ledger records it once, and a second migrate finds nothing to do', () => {
    const db = seededDatabaseBeforeTheMigration()

    // `toContain` rather than `toEqual([VERSION])`: the seeded database stops
    // just before this migration, so a full migrate applies it *and* every
    // migration added after it. What this test is about is that it lands once.
    expect(migrate(db, { registry: MIGRATIONS }).applied).toContain(VERSION)
    expect(migrate(db, { registry: MIGRATIONS }).applied).toEqual([])
    expect(
      db
        .query<{ total: number }, [string]>(
          `SELECT COUNT(*) AS total FROM ${LEDGER_TABLE} WHERE version = ?`,
        )
        .get(VERSION)?.total,
    ).toBe(1)

    db.close()
  })
})
