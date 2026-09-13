import type { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { type Clock, timestamp } from '#application/ports/clock.port'
import { checkedDb, execChecked } from '#infrastructure/sqlite/checked-exec'
import { LEDGER_TABLE, type LedgerRow, type Migration } from '#infrastructure/sqlite/migration'
import { MIGRATIONS } from '#infrastructure/sqlite/migrations/index'
import { systemClock } from '#infrastructure/system/system-clock.adapter'

export type MigrateOptions = {
  /** Defaults to the static registry; tests point it at a fixture set. */
  readonly registry?: readonly Migration[]
  /**
   * Where the pre-batch snapshot goes — `<root>/backups/db/` in the product,
   * placed by the caller. Omitted (tests) means no snapshot is taken.
   */
  readonly backupsDir?: string
  readonly clock?: Clock
}

export type MigrationRun = {
  /** Versions this call applied — empty when the schema was already current. */
  readonly applied: readonly string[]
  /** The batch they were applied as, so a rollback can undo the run as a unit. */
  readonly batch: number | undefined
  /** Path of the pre-batch snapshot, when one was taken. */
  readonly backup: string | undefined
}

export function ensureLedger(db: Database): void {
  execChecked(
    db,
    `
    CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
      version    TEXT    PRIMARY KEY,
      batch      INTEGER NOT NULL,
      applied_at TEXT    NOT NULL
    );
  `,
  )
}

export function ledgerRows(db: Database): readonly LedgerRow[] {
  return db.query<LedgerRow, []>(`SELECT version, batch, applied_at FROM ${LEDGER_TABLE}`).all()
}

function appliedVersions(db: Database): ReadonlySet<string> {
  return new Set(ledgerRows(db).map((row) => row.version))
}

function isApplied(db: Database, version: string): boolean {
  return (
    db
      .query<{ version: string }, [string]>(`SELECT version FROM ${LEDGER_TABLE} WHERE version = ?`)
      .get(version) !== null
  )
}

/**
 * Order is not decoration: the foreign keys point backwards through the registry,
 * so an out-of-order or duplicated entry would fail at apply time on a user's
 * machine rather than here. A registry the dev script mangled is caught on the
 * first call instead.
 */
function assertRegistryIsOrdered(registry: readonly Migration[]): void {
  registry.forEach((migration, index) => {
    const previous = registry[index - 1]
    if (previous !== undefined && previous.version >= migration.version) {
      throw new Error(
        `migration registry is out of order: ${previous.version} appears before ${migration.version}`,
      )
    }
  })
}

export function pendingMigrations(
  db: Database,
  registry: readonly Migration[] = MIGRATIONS,
): readonly Migration[] {
  assertRegistryIsOrdered(registry)
  ensureLedger(db)
  const applied = appliedVersions(db)
  return registry.filter((migration) => !applied.has(migration.version))
}

/**
 * `VACUUM INTO` a snapshot of the database as it was before this batch — the
 * thing `retro restore` puts back if a migration turns out to be wrong in
 * production (migrations.md). It cannot run inside a transaction, so it happens
 * before the first migration takes the write lock.
 *
 * A database that has never had a migration applied is skipped: there is no
 * earlier state to restore, and snapshotting an empty file on every fresh install
 * would fill `<root>/backups/db/` with nothing.
 */
function backupBeforeBatch(db: Database, backupsDir: string, batch: number, clock: Clock): string {
  mkdirSync(backupsDir, { recursive: true })
  const stamp = timestamp(clock).replace(/[:.]/g, '-')
  const path = join(backupsDir, `retro-${stamp}-pre-batch-${batch}.db`)
  db.run('VACUUM INTO ?', [path])
  return path
}

/**
 * Applies every pending migration (migrations.md).
 *
 * Whichever process touches the database first with a newer binary does this
 * work; the other blocks on the write lock, re-checks inside it, and finds
 * nothing to do. That re-check is why the ledger read and the ledger write live
 * in the same `BEGIN IMMEDIATE` — two processes carrying the same migration code
 * can race to start, but only one can be inside the transaction that claims a
 * version.
 *
 * One transaction per migration, and SQLite DDL is transactional, so a migration
 * that throws leaves the schema exactly as it was.
 */
export function migrate(db: Database, options: MigrateOptions = {}): MigrationRun {
  const registry = options.registry ?? MIGRATIONS
  const clock = options.clock ?? systemClock

  const pending = pendingMigrations(db, registry)
  if (pending.length === 0) return { applied: [], batch: undefined, backup: undefined }

  const isFreshDatabase = appliedVersions(db).size === 0
  const batch =
    (db
      .query<{ batch: number }, []>(`SELECT COALESCE(MAX(batch), 0) AS batch FROM ${LEDGER_TABLE}`)
      .get()?.batch ?? 0) + 1

  const backup =
    options.backupsDir === undefined || isFreshDatabase
      ? undefined
      : backupBeforeBatch(db, options.backupsDir, batch, clock)

  const applied: string[] = []
  for (const migration of pending) {
    db.run('BEGIN IMMEDIATE')
    try {
      if (isApplied(db, migration.version)) {
        // Another process won the race for this version while we waited.
        db.run('COMMIT')
        continue
      }
      // Through the checked facade, never the raw database: a runtime failure in
      // any statement of any migration has to reach the `catch` below, or the
      // ROLLBACK that makes "one transaction per migration" mean anything never
      // runs (#100 `r-db-exec-swallows-errors`).
      migration.up(checkedDb(db))
      db.run(`INSERT INTO ${LEDGER_TABLE} (version, batch, applied_at) VALUES (?, ?, ?)`, [
        migration.version,
        batch,
        timestamp(clock),
      ])
      db.run('COMMIT')
      applied.push(migration.version)
    } catch (error) {
      db.run('ROLLBACK')
      throw error
    }
  }

  return { applied, batch, backup }
}

/**
 * Undoes the most recent batch as a unit — Laravel's rollback, and the reason the
 * ledger records a batch at all.
 *
 * This is a development and test affordance. In production a bad migration is
 * undone by restoring the pre-batch snapshot, because `down()` can only reverse
 * what the schema knows about, never what the data lost (migrations.md).
 */
export function rollbackLastBatch(
  db: Database,
  options: Pick<MigrateOptions, 'registry'> = {},
): readonly string[] {
  const registry = options.registry ?? MIGRATIONS
  ensureLedger(db)

  const last = db
    .query<{ batch: number | null }, []>(`SELECT MAX(batch) AS batch FROM ${LEDGER_TABLE}`)
    .get()?.batch
  if (last === null || last === undefined) return []

  const versions = db
    .query<{ version: string }, [number]>(
      `SELECT version FROM ${LEDGER_TABLE} WHERE batch = ? ORDER BY version DESC`,
    )
    .all(last)
    .map((row) => row.version)

  const rolledBack: string[] = []
  for (const version of versions) {
    const migration = registry.find((candidate) => candidate.version === version)
    if (migration === undefined) {
      throw new Error(`cannot roll back ${version}: it is not in the migration registry`)
    }
    db.run('BEGIN IMMEDIATE')
    try {
      migration.down(checkedDb(db))
      db.run(`DELETE FROM ${LEDGER_TABLE} WHERE version = ?`, [version])
      db.run('COMMIT')
      rolledBack.push(version)
    } catch (error) {
      db.run('ROLLBACK')
      throw error
    }
  }

  return rolledBack
}
