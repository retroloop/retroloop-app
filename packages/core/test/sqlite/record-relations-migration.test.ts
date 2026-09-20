import { Database } from 'bun:sqlite'
import { afterAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { MIGRATIONS } from '#infrastructure/sqlite/migrations/index'
import { migrate } from '#infrastructure/sqlite/migrator'
import { createTempStage, removeTempStages } from '../support/temp-stage'

afterAll(removeTempStages)

const VERSION = '20260901090500'
const INDEX = MIGRATIONS.findIndex((migration) => migration.version === VERSION)
const MIGRATION = MIGRATIONS[INDEX]

/**
 * The relation table, per the per-migration precedent this repository keeps for
 * every table with rules of its own (`record-ids-migration.test.ts`,
 * `record-lifecycle-archive-migration.test.ts`).
 *
 * `migrator.test.ts` runs `up → down → up` over every migration and compares the
 * schema text, which answers *"does `up` say everything it does"*. It says
 * nothing about what the constraints actually refuse, and this table's whole
 * design is in its constraints: two foreign keys onto the one single-column
 * handle a record has, a self-relation the store cannot hold, one version
 * sequence per **ordered** pair, and words that are never null.
 *
 * The seeded store is the shape the feature exists for — two retrospectives, one
 * of them closed long ago — because the relation exists for the case that
 * crosses them: the AI finding past records and building holistic solutions.
 */
function storeBeforeTheMigration(): Database {
  const db = new Database(join(createTempStage(), 'retro.db'), { create: true })
  db.run('PRAGMA foreign_keys = ON')
  migrate(db, { registry: MIGRATIONS.slice(0, INDEX) })

  db.exec(`
    INSERT INTO sessions (id, claude_session, project, cwd, branch, supervised, started_at)
      VALUES (1, 'uuid-1', 'retro', '/tmp/retro', 'main', 1, '2026-08-23T09:00:00.000Z');
    INSERT INTO retrospectives (id, session_id, state, started_at, finished_at)
      VALUES (1, 1, 'finished', '2026-08-23T09:00:00.000Z', '2026-08-24T09:00:00.000Z'),
             (2, 1, 'reviewing', '2026-09-01T09:00:00.000Z', NULL);

    INSERT INTO record_ids (id, retro_id, rid)
      VALUES (1, 1, 'r-stale-lock'),
             (2, 1, 'r-silent-tailer'),
             (3, 2, 'r-stale-lock');
  `)
  return db
}

function migrated(): Database {
  const db = storeBeforeTheMigration()
  migrate(db, { registry: MIGRATIONS })
  return db
}

function relate(
  fromId: number,
  toId: number,
  options: {
    readonly version?: number
    readonly applied?: number
    readonly how?: string
    readonly actor?: string
  } = {},
): string {
  const { version = 1, applied = 1, how = 'supersedes', actor = 'ai' } = options
  return `INSERT INTO record_relations (from_id, to_id, version, applied, how, actor, at)
          VALUES (${fromId}, ${toId}, ${version}, ${applied}, '${how}', '${actor}',
                  '2026-09-01T10:00:00.000Z')`
}

function indexesOn(db: Database, table: string): string[] {
  return db
    .query<{ name: string }, [string]>(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    )
    .all(table)
    .map((row) => row.name)
}

describe('create_record_relations', () => {
  test('is in the registry, after the table both its foreign keys point at', () => {
    expect(MIGRATION?.name).toBe('create_record_relations')
    const after = (name: string) => MIGRATIONS.findIndex((migration) => migration.name === name)
    // "Parents before children: the foreign keys point backwards through this
    // list" (`migrations/index.ts`) — and this table's parent is `record_ids`,
    // not a retrospective, which is the departure worth pinning.
    expect(INDEX).toBeGreaterThan(after('create_record_ids'))
  })

  /** The red half: the table is what this migration adds, so it was not there. */
  test('the table did not exist before it ran', () => {
    const db = storeBeforeTheMigration()

    expect(() => db.run(relate(1, 2))).toThrow(/no such table/)

    db.close()
  })

  test('relates two records across two retrospectives — the case the feature exists for', () => {
    const db = migrated()

    db.run(relate(3, 1, { how: 'the same lock, found again' }))

    expect(
      db
        .query<{ from_id: number; to_id: number; how: string }, []>(
          'SELECT from_id, to_id, how FROM record_relations',
        )
        .all(),
    ).toEqual([{ from_id: 3, to_id: 1, how: 'the same lock, found again' }])

    db.close()
  })

  /**
   * **Both sides are `record_ids.id` and nothing else can be written there.** A
   * relation naming a number the store never minted is not a relation to a
   * record it has not seen yet — it is a row nothing can ever resolve.
   */
  test('refuses a side that names no minted record', () => {
    const db = migrated()

    expect(() => db.run(relate(1, 404))).toThrow(/FOREIGN KEY/)
    expect(() => db.run(relate(404, 1))).toThrow(/FOREIGN KEY/)

    db.close()
  })

  /** A record related to itself says nothing, and L1 will not hold the row. */
  test('refuses a record related to itself', () => {
    const db = migrated()

    expect(() => db.run(relate(1, 1))).toThrow(/CHECK/)

    db.close()
  })

  /**
   * **The words are half the act** — each relation carries how-they-relate
   * words — so the column is `NOT NULL` rather than offered. The use case's
   * schema refuses an empty string above this; what L1 refuses is the absence.
   */
  test('refuses a relation with no words, and an actor nobody defined', () => {
    const db = migrated()

    expect(() =>
      db.run(
        `INSERT INTO record_relations (from_id, to_id, version, applied, actor, at)
         VALUES (1, 2, 1, 1, 'ai', '2026-09-01T10:00:00.000Z')`,
      ),
    ).toThrow(/NOT NULL/)
    expect(() => db.run(relate(1, 2, { actor: 'nobody' }))).toThrow(/CHECK/)
    expect(() => db.run(relate(1, 2, { applied: 2 }))).toThrow(/CHECK/)
    expect(() => db.run(relate(1, 2, { version: 0 }))).toThrow(/CHECK/)

    db.close()
  })

  /**
   * **The version sequence is dense per ordered pair**, which is what makes the
   * reverse relation a different row rather than a conflict: `(#1, #2)` and
   * `(#2, #1)` are two statements with two histories.
   */
  test('versions per ordered pair — and the reverse pair is a row of its own', () => {
    const db = migrated()

    db.run(relate(1, 2, { version: 1, applied: 1, how: 'supersedes' }))
    db.run(relate(1, 2, { version: 2, applied: 0, how: 'supersedes' }))
    db.run(relate(2, 1, { version: 1, applied: 1, how: 'was superseded by' }))

    expect(() => db.run(relate(1, 2, { version: 2, how: 'again' }))).toThrow(/UNIQUE/)
    expect(db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM record_relations').get()).toEqual(
      { n: 3 },
    )

    db.close()
  })

  /**
   * One index per side, because the read this table exists for asks about both
   * columns in one `OR`, because the relation reads from both sides — and a
   * single composite index would serve only the half that leads with its first
   * column.
   */
  test('indexes both sides, and ships its triggers with the table', () => {
    const db = migrated()

    expect(indexesOn(db, 'record_relations')).toEqual([
      'ix_record_relations_from',
      'ix_record_relations_to',
    ])

    db.run(relate(1, 2))
    expect(() => db.run("UPDATE record_relations SET how = 'rewritten'")).toThrow(/append-only/)
    expect(() => db.run('DELETE FROM record_relations')).toThrow(/never deleted/)

    db.close()
  })

  /**
   * **Nothing is backfilled and nothing could be.** A relation is an assertion
   * somebody makes; deriving one from two records that mention the same file
   * would be the store asserting a fact about the past nobody recorded — the
   * doctrine `solutions_anchor_and_selection.ts` states and `create_record_ids`
   * names its own exemption from.
   */
  test('writes no rows of its own', () => {
    const db = migrated()

    expect(db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM record_relations').get()).toEqual(
      { n: 0 },
    )

    db.close()
  })

  /** `down` is mandatory, and a migration nobody can reverse is one nobody can test. */
  test('down takes the table away and up puts it back', () => {
    const db = migrated()
    db.run(relate(1, 2))

    MIGRATION?.down(db)
    expect(() => db.run(relate(1, 2))).toThrow(/no such table/)

    MIGRATION?.up(db)
    db.run(relate(1, 2))
    expect(db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM record_relations').get()).toEqual(
      { n: 1 },
    )

    db.close()
  })
})
