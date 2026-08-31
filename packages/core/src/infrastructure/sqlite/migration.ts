import type { MigrationDb } from '#infrastructure/sqlite/checked-exec'

/**
 * One schema change, both ways (migrations.md).
 *
 * `down` is mandatory — not because production ever rolls back (that is
 * `retro restore` of the pre-batch snapshot) but because a migration you cannot
 * reverse is a migration nobody can test. The `up → down → up` round-trip is what
 * proves `up` says everything it does.
 *
 * SQLite DDL is transactional, and the migrator runs each of these inside one
 * transaction, so a migration that throws half-way leaves nothing behind — which
 * is only true if a failure inside `up` actually reaches the migrator. It did not
 * used to: `db` is a `MigrationDb` rather than a `Database` because bun's `exec`
 * drops a runtime failure in anything but a lone statement, so a migration could
 * half-apply in silence and be ledgered as applied (#100
 * `r-db-exec-swallows-errors`; the whole argument is in `checked-exec.ts`). The
 * narrower type is what makes that unreachable for a migration nobody has written
 * yet, rather than for the ones that happened to be converted.
 */
export type Migration = {
  /** Timestamp prefix of the filename; sorts lexicographically into apply order. */
  readonly version: string
  readonly name: string
  up(db: MigrationDb): void
  down(db: MigrationDb): void
}

/** Laravel's ledger: which versions ran, in which batch, when (migrations.md). */
export const LEDGER_TABLE = 'schema_migrations'

export type LedgerRow = {
  readonly version: string
  readonly batch: number
  readonly applied_at: string
}

/**
 * The append-only backstop of the actor model (architecture.md §Actor model).
 *
 * Human-authored rows cannot be updated or deleted **even by a rogue writer that
 * opens the database directly**, which is the one guarantee the use-case layer
 * cannot make for itself. The trigger pair ships in the same migration as the
 * table, so no schema version ever exists in which the table is unprotected.
 */
export function appendOnlyTriggers(table: string, reason: string): string {
  return `
    CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN
      SELECT RAISE(ABORT, '${table} are append-only: ${reason}');
    END;
    CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN
      SELECT RAISE(ABORT, '${table} are never deleted: ${reason}');
    END;
  `
}
