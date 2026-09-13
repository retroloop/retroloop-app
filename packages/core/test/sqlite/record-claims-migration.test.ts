import { Database } from 'bun:sqlite'
import { afterAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { MIGRATIONS } from '#infrastructure/sqlite/migrations/index'
import { migrate } from '#infrastructure/sqlite/migrator'
import { createTempStage, removeTempStages } from '../support/temp-stage'

afterAll(removeTempStages)

const VERSION = '20260913090000'
const INDEX = MIGRATIONS.findIndex((migration) => migration.version === VERSION)
const MIGRATION = MIGRATIONS[INDEX]

/**
 * The in-progress marker's table, per the per-migration precedent this
 * repository keeps for every table with rules of its own
 * (`record-relations-migration.test.ts`, `record-lifecycle-archive-migration.test.ts`).
 *
 * `migrator.test.ts` runs `up → down → up` over every migration and compares the
 * schema text, which answers *"does `up` say everything it does"*. It says
 * nothing about what the constraints refuse, and a claim's whole correctness is
 * in its constraints: a bit that is only ever 0 or 1, an actor the store has
 * heard of, one dense version sequence per `(retro_id, rid)`, and a
 * retrospective the row actually belongs to.
 *
 * **It is addressed `(retro_id, rid)` and not by global id**, which is the
 * departure from the relation table beside it and is the point: a claim is a
 * marker on *one* record, so it takes the address every other per-record table
 * here takes (`record-key.service.ts`).
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
  `)
  return db
}

function migrated(): Database {
  const db = storeBeforeTheMigration()
  migrate(db, { registry: MIGRATIONS })
  return db
}

function claim(
  options: {
    readonly retroId?: number
    readonly rid?: string
    readonly version?: number
    readonly claimed?: number
    readonly actor?: string
  } = {},
): string {
  const { retroId = 1, rid = 'r-stale-lock', version = 1, claimed = 1, actor = 'ai' } = options
  return `INSERT INTO record_claims (retro_id, rid, version, claimed, actor, at)
          VALUES (${retroId}, '${rid}', ${version}, ${claimed}, '${actor}',
                  '2026-09-13T10:00:00.000Z')`
}

function indexesOn(db: Database, table: string): string[] {
  return db
    .query<{ name: string }, [string]>(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    )
    .all(table)
    .map((row) => row.name)
}

describe('create_record_claims', () => {
  test('is in the registry, after the table its foreign key points at', () => {
    expect(MIGRATION?.name).toBe('create_record_claims')
    const after = (name: string) => MIGRATIONS.findIndex((migration) => migration.version === name)
    expect(INDEX).toBeGreaterThan(after('20260823120100'))
  })

  /** The red half: the table is what this migration adds, so it was not there. */
  test('the table did not exist before it ran', () => {
    const db = storeBeforeTheMigration()

    expect(() => db.run(claim())).toThrow(/no such table/)

    db.close()
  })

  test('marks a record claimed, and un-claims it in a second version', () => {
    const db = migrated()

    db.run(claim({ version: 1, claimed: 1 }))
    db.run(claim({ version: 2, claimed: 0, actor: 'human' }))

    expect(
      db
        .query<{ version: number; claimed: number; actor: string }, []>(
          'SELECT version, claimed, actor FROM record_claims ORDER BY version',
        )
        .all(),
    ).toEqual([
      { version: 1, claimed: 1, actor: 'ai' },
      { version: 2, claimed: 0, actor: 'human' },
    ])

    db.close()
  })

  /**
   * A claim belongs to a record of a retrospective, so the retrospective has to
   * be one the store holds — the same foreign key `record_lifecycle` takes, and
   * the reason this table is not keyed on a global id.
   */
  test('refuses a claim on a retrospective that is not there', () => {
    const db = migrated()

    expect(() => db.run(claim({ retroId: 404 }))).toThrow(/FOREIGN KEY/)

    db.close()
  })

  /**
   * **Both actors are accepted and nothing else is.** The row records which of
   * them marked the record, and the CHECK is what makes the adapter's narrowing
   * of that column true whatever opens the database.
   */
  test('refuses a claim that is neither claimed nor released, and an actor nobody defined', () => {
    const db = migrated()

    expect(() => db.run(claim({ claimed: 2 }))).toThrow(/CHECK/)
    expect(() => db.run(claim({ actor: 'nobody' }))).toThrow(/CHECK/)
    expect(() => db.run(claim({ version: 0 }))).toThrow(/CHECK/)
    expect(() =>
      db.run(
        `INSERT INTO record_claims (retro_id, rid, version, actor, at)
         VALUES (1, 'r-stale-lock', 1, 'ai', '2026-09-13T10:00:00.000Z')`,
      ),
    ).toThrow(/NOT NULL/)

    db.close()
  })

  /**
   * One dense sequence per `(retro_id, rid)` — and a rid is minted **per
   * retrospective**, so the same slug in two retrospectives is two records with
   * two sequences of their own.
   */
  test('versions per record, and the same rid in another retrospective is another record', () => {
    const db = migrated()

    db.run(claim({ retroId: 1, version: 1 }))
    db.run(claim({ retroId: 2, version: 1 }))

    expect(() => db.run(claim({ retroId: 1, version: 1, claimed: 0 }))).toThrow(/UNIQUE/)
    expect(db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM record_claims').get()).toEqual({
      n: 2,
    })

    db.close()
  })

  /**
   * One index, on the key every read of this table uses — `findLatest` asks for
   * one record's highest version and `listLatestForEachRecord` groups by the
   * same pair. There is no second side to index: unlike a relation, a claim
   * names one record.
   */
  test('indexes the record, and ships its triggers with the table', () => {
    const db = migrated()

    expect(indexesOn(db, 'record_claims')).toEqual(['ix_record_claims_record'])

    db.run(claim())
    expect(() => db.run('UPDATE record_claims SET claimed = 0')).toThrow(/append-only/)
    expect(() => db.run('DELETE FROM record_claims')).toThrow(/never deleted/)

    db.close()
  })

  /**
   * **Nothing is backfilled, and nothing could be.** A claim is somebody saying
   * they are working on a record right now; reading one out of a store's history
   * would be the database asserting a fact about the past nobody recorded.
   */
  test('writes no rows of its own', () => {
    const db = migrated()

    expect(db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM record_claims').get()).toEqual({
      n: 0,
    })

    db.close()
  })

  /** `down` is mandatory, and a migration nobody can reverse is one nobody can test. */
  test('down takes the table away and up puts it back', () => {
    const db = migrated()
    db.run(claim())

    MIGRATION?.down(db)
    expect(() => db.run(claim())).toThrow(/no such table/)

    MIGRATION?.up(db)
    db.run(claim())
    expect(db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM record_claims').get()).toEqual({
      n: 1,
    })

    db.close()
  })
})
