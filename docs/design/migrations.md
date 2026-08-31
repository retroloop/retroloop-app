# Migrations

Laravel/Rails-style migrations adapted to SQLite and a compiled single binary.

- **Files:** `packages/core/src/infrastructure/sqlite/migrations/20260822143000_create_sessions.ts` — timestamp prefix = version; each exports `up(db)` and `down(db)`; `down` is mandatory.
- **Ledger table:** `schema_migrations(version TEXT PRIMARY KEY, batch INTEGER, applied_at TEXT)` — Laravel's *batch* so a rollback undoes the last run as a unit.
- **Static registry:** `migrations/index.ts` statically imports every migration (a compiled binary cannot glob a directory). Maintained by the dev script.
- **`make:migration` is a dev script** (`bun run make:migration <name>`), not a binary command: scaffolds the file AND appends it to the registry.
- **Automatic at startup, invisible in the CLI:** whichever process touches the DB first with a newer binary applies pending migrations under an exclusive lock (`BEGIN IMMEDIATE` against `PRAGMA user_version` / the ledger). The other process waits on the lock, re-checks, finds nothing pending, proceeds. Both processes are the same artifact, so they always carry the same migration code — that is why there is no race. Status surfaces only in `doctor`.
- **Backup first:** a `VACUUM INTO` snapshot into `<stage>/backups/` before applying any batch. Rollback in production = `retro restore` of that snapshot; `down()` exists for dev iteration and migration tests.
- **Transactional DDL:** SQLite DDL is transactional — each migration runs inside one transaction; a failure leaves nothing half-applied.
- **Additive-first policy:** new columns/tables ship before code depends on them; destructive changes ship in a later release than the code that stopped using the column. Covers the brief window where an old server may see a newer schema (hand-swapped binary).
- **SQLite rebuild pattern:** `ALTER TABLE` is limited (add column, rename; drop column ≥3.35). Anything else: `CREATE new → INSERT SELECT → DROP old → RENAME`, inside the migration's transaction.
- **Append-only enforcement lives in migrations:** the migrations that create human-authored tables (comments, notes, annotations, decisions, holds) also create the triggers rejecting `UPDATE`/`DELETE` — the L1 backstop of the actor model.
- **Tests** (always-on suite 1): `up → down → up` round-trip per migration; upgrade from a seeded older schema; trigger enforcement; backup-created check.
