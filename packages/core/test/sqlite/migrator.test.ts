import { Database } from 'bun:sqlite'
import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { checkedDb } from '#infrastructure/sqlite/checked-exec'
import type { Migration } from '#infrastructure/sqlite/migration'
import { appendOnlyTriggers, LEDGER_TABLE } from '#infrastructure/sqlite/migration'
import { MIGRATIONS } from '#infrastructure/sqlite/migrations/index'
import {
  ledgerRows,
  migrate,
  pendingMigrations,
  rollbackLastBatch,
} from '#infrastructure/sqlite/migrator'
import { openSqliteStore } from '#infrastructure/sqlite/sqlite-store.adapter'
import { createFakeClock } from '../support/fake-clock'
import { createTempStage, removeTempStages } from '../support/temp-stage'

afterAll(removeTempStages)

function openRaw(): { db: Database; dir: string } {
  const dir = createTempStage()
  const db = new Database(join(dir, 'retro.db'), { create: true })
  db.run('PRAGMA foreign_keys = ON')
  return { db, dir }
}

/** Every object in the schema, with the SQL that defines it. */
function schemaOf(db: Database): { type: string; name: string; sql: string | null }[] {
  return db
    .query<{ type: string; name: string; sql: string | null }, []>(
      `SELECT type, name, sql FROM sqlite_master
       WHERE name NOT LIKE 'sqlite_%' AND name <> '${LEDGER_TABLE}'
       ORDER BY type, name`,
    )
    .all()
}

describe('migrator', () => {
  test('applies every migration on a fresh database, as one batch', () => {
    const { db } = openRaw()

    const run = migrate(db, { clock: createFakeClock() })

    expect(run.applied).toEqual(MIGRATIONS.map((migration) => migration.version))
    expect(run.batch).toBe(1)
    expect(ledgerRows(db)).toHaveLength(MIGRATIONS.length)
    expect(ledgerRows(db).every((row) => row.batch === 1)).toBe(true)
    expect(ledgerRows(db)[0]?.applied_at).toBe('2026-08-23T09:00:00.000Z')
  })

  test('is a no-op the second time — the hot path of every CLI command', () => {
    const { db } = openRaw()
    migrate(db)

    const again = migrate(db)

    expect(again.applied).toEqual([])
    expect(again.batch).toBeUndefined()
    expect(pendingMigrations(db)).toEqual([])
  })

  test('a second process opening the same stage finds nothing to do', () => {
    const dir = createTempStage()
    const first = openSqliteStore({ dataDir: dir, clock: createFakeClock() })
    const second = openSqliteStore({ dataDir: dir, clock: createFakeClock() })

    // Both carry the same migration code; the one that got there second waited on
    // the write lock, re-checked inside it, and found the schema already current.
    const db = new Database(join(dir, 'retro.db'))
    expect(ledgerRows(db)).toHaveLength(MIGRATIONS.length)
    expect(pendingMigrations(db)).toEqual([])
    db.close()

    return Promise.all([first.close(), second.close()])
  })

  describe('up → down → up', () => {
    for (const [index, migration] of MIGRATIONS.entries()) {
      test(`${migration.version}_${migration.name} reverses exactly what it did`, () => {
        const { db } = openRaw()
        // Everything this migration depends on, and nothing after it.
        migrate(db, { registry: MIGRATIONS.slice(0, index) })
        // Through the same facade the migrator uses, so this round-trip runs
        // every migration's SQL one statement at a time — which is the only way
        // a runtime failure in any of them reaches this test at all. A raw
        // `Database` is structurally acceptable here and would quietly put
        // every one of them back on the swallowing path, so the wrapping is
        // the assertion. (It used to assert an exact migration count until more
        // were added, which is why it counts nothing now.)
        const checked = checkedDb(db)

        const before = schemaOf(db)
        migration.up(checked)
        const after = schemaOf(db)
        // Not "the schema grew": a rebuild migration replaces an object's DDL
        // without adding one (20260825090000), and comparing the whole schema
        // catches that as well as an added table.
        expect(after).not.toEqual(before)

        migration.down(checked)
        expect(schemaOf(db)).toEqual(before)

        migration.up(checked)
        expect(schemaOf(db)).toEqual(after)
      })
    }
  })

  test('rolls back the last batch as a unit', () => {
    const { db } = openRaw()
    const firstBatch = MIGRATIONS.slice(0, 3)
    migrate(db, { registry: firstBatch })
    migrate(db, { registry: MIGRATIONS })

    const rolledBack = rollbackLastBatch(db)

    expect(rolledBack).toHaveLength(MIGRATIONS.length - firstBatch.length)
    expect(ledgerRows(db).map((row) => row.version)).toEqual(
      firstBatch.map((migration) => migration.version),
    )
    // The first batch is untouched: rollback undoes a run, not everything.
    expect(schemaOf(db).map((entry) => entry.name)).toContain('sessions')
    expect(schemaOf(db).map((entry) => entry.name)).not.toContain('events')
  })

  test('upgrades a database that was seeded with an older schema', () => {
    const { db } = openRaw()
    migrate(db, { registry: MIGRATIONS.slice(0, 2) })
    db.run(
      `INSERT INTO sessions (claude_session, project, cwd, branch, supervised, started_at)
       VALUES ('uuid-old', 'retro', '/tmp', 'main', 1, '2026-01-01T00:00:00.000Z')`,
    )

    const run = migrate(db, { registry: MIGRATIONS })

    expect(run.applied).toHaveLength(MIGRATIONS.length - 2)
    expect(run.batch).toBe(2)
    // The data written under the old schema is still there, untouched.
    expect(db.query<{ project: string }, []>('SELECT project FROM sessions').get()?.project).toBe(
      'retro',
    )
    expect(schemaOf(db).map((entry) => entry.name)).toContain('events')
  })

  /**
   * `20260825120000_create_holds` is the only migration that moves data, and the
   * data it moves does not exist in the store used in production: every one of its 35
   * decisions is `approved`, as are the 13 in its pre-batch backup, and none of
   * the three exports contains a `hold`. A step nothing exercises is a step
   * nobody has seen work, so the rows are seeded by hand here.
   *
   * What it must do (`r-hold-semantics`): a record whose **latest** verdict was
   * `hold` reads as held under the new model, carrying the reviewer's note as
   * its reason — and the decision row itself is left exactly where it was,
   * because human data is never rewritten.
   */
  describe('create_holds carries a legacy hold verdict onto the new axis', () => {
    const holds = MIGRATIONS.findIndex((migration) => migration.name === 'create_holds')

    function seedDecided(db: Database): void {
      db.run(
        `INSERT INTO sessions (claude_session, project, cwd, branch, supervised, started_at)
         VALUES ('uuid-old', 'retro', '/tmp', 'main', 1, '2026-01-01T00:00:00.000Z')`,
      )
      db.run(
        `INSERT INTO retrospectives (session_id, state, started_at)
         VALUES (1, 'finished', '2026-01-01T00:00:00.000Z')`,
      )
      const decide = (rid: string, version: number, state: string, note: string | null) =>
        db.run(
          `INSERT INTO decisions (retro_id, rid, version, state, severity, solution_level,
                                  involvement, reviewer_note, revision_n, content_hash, decided_at)
           VALUES (1, ?, ?, ?, 3, '2', 'pull-request', ?, 1, 'hash', '2026-01-02T00:00:00.000Z')`,
          [rid, version, state, note],
        )

      decide('r-parked', 1, 'hold', 'Not until the release ships.')
      decide('r-parked-quietly', 1, 'hold', null)
      decide('r-approved', 1, 'approved', null)
      // Held, then let go: the human already moved past it, and reviving that
      // hold would be the migration inventing a fact.
      decide('r-let-go', 1, 'hold', 'Was risky.')
      decide('r-let-go', 2, 'approved', null)
    }

    test('maps the records still held, and only those', () => {
      const { db } = openRaw()
      migrate(db, { registry: MIGRATIONS.slice(0, holds) })
      seedDecided(db)

      migrate(db, { registry: MIGRATIONS })

      expect(
        db
          .query<
            { rid: string; version: number; held: number; note: string | null; at: string },
            []
          >('SELECT rid, version, held, note, at FROM holds ORDER BY rid')
          .all(),
      ).toEqual([
        {
          rid: 'r-parked',
          version: 1,
          held: 1,
          note: 'Not until the release ships.',
          at: '2026-01-02T00:00:00.000Z',
        },
        {
          rid: 'r-parked-quietly',
          version: 1,
          held: 1,
          note: null,
          at: '2026-01-02T00:00:00.000Z',
        },
      ])
    })

    test('leaves every decision row exactly as the human left it', () => {
      const { db } = openRaw()
      migrate(db, { registry: MIGRATIONS.slice(0, holds) })
      seedDecided(db)
      const before = db
        .query<{ rid: string; state: string }, []>('SELECT rid, state FROM decisions ORDER BY id')
        .all()

      migrate(db, { registry: MIGRATIONS })

      expect(
        db
          .query<{ rid: string; state: string }, []>('SELECT rid, state FROM decisions ORDER BY id')
          .all(),
      ).toEqual(before)
    })

    /**
     * A brand-new store, in the only way a test can hold it: nothing to map.
     * The insert has to be a no-op rather than an error on a database where no
     * record was ever held — which is every database the product has written.
     */
    test('maps nothing on a store that never held a verdict', () => {
      const { db } = openRaw()

      migrate(db, { registry: MIGRATIONS })

      expect(
        db.query<{ total: number }, []>('SELECT COUNT(*) AS total FROM holds').get()?.total,
      ).toBe(0)
    })
  })

  describe('backup before a batch', () => {
    test('is skipped on a fresh database — there is no earlier state to restore', () => {
      const { db, dir } = openRaw()

      const run = migrate(db, { backupsDir: join(dir, 'backups'), clock: createFakeClock() })

      expect(run.backup).toBeUndefined()
      expect(existsSync(join(dir, 'backups'))).toBe(false)
    })

    test('snapshots the pre-batch database before an upgrade applies', () => {
      const { db, dir } = openRaw()
      const backups = join(dir, 'backups')
      migrate(db, { registry: MIGRATIONS.slice(0, 2), backupsDir: backups })
      db.run(
        `INSERT INTO sessions (claude_session, project, cwd, branch, supervised, started_at)
         VALUES ('uuid-old', 'retro', '/tmp', 'main', 1, '2026-01-01T00:00:00.000Z')`,
      )

      const run = migrate(db, { backupsDir: backups, clock: createFakeClock() })

      expect(run.backup).toBeDefined()
      expect(readdirSync(backups)).toHaveLength(1)

      // The snapshot is a real database holding the state from *before* the batch.
      const snapshot = new Database(run.backup as string)
      expect(
        snapshot.query<{ claude_session: string }, []>('SELECT claude_session FROM sessions').get()
          ?.claude_session,
      ).toBe('uuid-old')
      expect(
        snapshot
          .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE name = 'events'")
          .get(),
      ).toBeNull()
      snapshot.close()
    })
  })

  test('leaves nothing half-applied when a migration throws', () => {
    const { db } = openRaw()
    const broken: Migration = {
      version: '29990101000000',
      name: 'broken',
      up(database) {
        database.exec('CREATE TABLE half_applied (id INTEGER PRIMARY KEY)')
        database.exec('THIS IS NOT SQL')
      },
      down(database) {
        database.exec('DROP TABLE half_applied')
      },
    }

    expect(() => migrate(db, { registry: [...MIGRATIONS, broken] })).toThrow()

    // DDL is transactional: the table the migration managed to create is gone,
    // and the ledger never claimed the version.
    expect(schemaOf(db).map((entry) => entry.name)).not.toContain('half_applied')
    expect(ledgerRows(db).map((row) => row.version)).not.toContain('29990101000000')
  })

  /**
   * **The plant that started `r-db-exec-swallows-errors`, as a test.**
   *
   * The test above uses a prepare-time error, which bun has always reported. This
   * one uses the failure it did not: a benign INSERT, then an UPDATE the
   * append-only triggers must refuse, in one multi-statement batch. Before the
   * checked exec the migration below applied its first statement, had its second
   * silently dropped, ran its third anyway, returned cleanly, and was ledgered as
   * applied — which is a migration that half-applied and said it was fine.
   *
   * Both halves are asserted because either one alone would pass on a broken
   * fix: that it throws, and that the transaction took the whole batch with it.
   */
  test('a runtime refusal inside a migration aborts the batch instead of vanishing', () => {
    const { db } = openRaw()
    const swallowed: Migration = {
      version: '29990101000000',
      name: 'swallowed_update',
      up(database) {
        database.exec(`
          CREATE TABLE guarded_by_trigger (id INTEGER PRIMARY KEY, v TEXT NOT NULL);
          ${appendOnlyTriggers('guarded_by_trigger', 'the plant needs a runtime refusal')}
          INSERT INTO guarded_by_trigger (id, v) VALUES (1, 'original');
          UPDATE guarded_by_trigger SET v = 'rewritten' WHERE id = 1;
          CREATE TABLE ran_after (id INTEGER PRIMARY KEY);
        `)
      },
      down(database) {
        database.exec('DROP TABLE guarded_by_trigger; DROP TABLE ran_after;')
      },
    }

    expect(() => migrate(db, { registry: [...MIGRATIONS, swallowed] })).toThrow(
      /guarded_by_trigger are append-only/,
    )

    // Nothing of it survived: not the table it created before the refusal, not
    // the one the statement *after* the refusal would have created, and not a
    // ledger row claiming the version applied.
    const objects = schemaOf(db).map((entry) => entry.name)
    expect(objects).not.toContain('guarded_by_trigger')
    expect(objects).not.toContain('ran_after')
    expect(ledgerRows(db).map((row) => row.version)).not.toContain('29990101000000')
  })

  test('skips a version another process claimed while we were waiting', () => {
    const { db } = openRaw()
    let secondRan = false

    // Standing in for the other process: by the time the loop reaches the second
    // version, the ledger already claims it. That is what the losing process sees
    // when it finally gets the write lock — and the re-check that reads the ledger
    // inside the same transaction as the write is what makes the skip safe.
    const claimer: Migration = {
      version: '29990101000000',
      name: 'claimer',
      up(database) {
        database.run(
          `INSERT INTO ${LEDGER_TABLE} (version, batch, applied_at) VALUES ('29990101000001', 99, '2026-01-01T00:00:00.000Z')`,
        )
      },
      down() {},
    }
    const claimed: Migration = {
      version: '29990101000001',
      name: 'claimed',
      up() {
        secondRan = true
      },
      down() {},
    }

    const run = migrate(db, { registry: [...MIGRATIONS, claimer, claimed] })

    expect(secondRan).toBe(false)
    expect(run.applied).not.toContain('29990101000001')
  })

  test('refuses a registry that is out of order', () => {
    const { db } = openRaw()
    const reversed = [...MIGRATIONS].reverse()

    expect(() => migrate(db, { registry: reversed })).toThrow(/out of order/)
  })
})
