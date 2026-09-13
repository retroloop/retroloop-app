import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Clock } from '#application/ports/clock.port'
import type { Repositories, Store } from '#application/ports/store.port'
import { migrate } from '#infrastructure/sqlite/migrator'
import { SqliteAnnotationRepository } from '#infrastructure/sqlite/repositories/annotation.sqlite.adapter'
import { SqliteAttributeDefinitionRepository } from '#infrastructure/sqlite/repositories/attribute-definition.sqlite.adapter'
import { SqliteCommentThreadRepository } from '#infrastructure/sqlite/repositories/comment-thread.sqlite.adapter'
import { SqliteCursorRepository } from '#infrastructure/sqlite/repositories/cursor.sqlite.adapter'
import { SqliteDecisionRepository } from '#infrastructure/sqlite/repositories/decision.sqlite.adapter'
import { SqliteEventRepository } from '#infrastructure/sqlite/repositories/event.sqlite.adapter'
import { SqliteFinishMessageRepository } from '#infrastructure/sqlite/repositories/finish-message.sqlite.adapter'
import { SqliteHoldRepository } from '#infrastructure/sqlite/repositories/hold.sqlite.adapter'
import { SqliteLabelDefinitionRepository } from '#infrastructure/sqlite/repositories/label-definition.sqlite.adapter'
import { SqliteNoteRepository } from '#infrastructure/sqlite/repositories/note.sqlite.adapter'
import { SqliteRecordAttributeValueRepository } from '#infrastructure/sqlite/repositories/record-attribute-value.sqlite.adapter'
import { SqliteRecordClaimRepository } from '#infrastructure/sqlite/repositories/record-claim.sqlite.adapter'
import { SqliteRecordIdRepository } from '#infrastructure/sqlite/repositories/record-id.sqlite.adapter'
import { SqliteRecordLabelRepository } from '#infrastructure/sqlite/repositories/record-label.sqlite.adapter'
import { SqliteRecordLifecycleRepository } from '#infrastructure/sqlite/repositories/record-lifecycle.sqlite.adapter'
import { SqliteRecordRelationRepository } from '#infrastructure/sqlite/repositories/record-relation.sqlite.adapter'
import { SqliteRequestRepository } from '#infrastructure/sqlite/repositories/request.sqlite.adapter'
import { SqliteRetrospectiveRepository } from '#infrastructure/sqlite/repositories/retrospective.sqlite.adapter'
import { SqliteRevisionRepository } from '#infrastructure/sqlite/repositories/revision.sqlite.adapter'
import { SqliteSessionRepository } from '#infrastructure/sqlite/repositories/session.sqlite.adapter'
import { SqliteSettingRepository } from '#infrastructure/sqlite/repositories/setting.sqlite.adapter'
import { SqliteThreadResolutionRepository } from '#infrastructure/sqlite/repositories/thread-resolution.sqlite.adapter'
import { systemClock } from '#infrastructure/system/system-clock.adapter'

/** The stage's database file (architecture.md §Stages). */
export const DATABASE_FILENAME = 'retro.db'
/** Fallback only: in the product the CLI places snapshots in `<root>/backups/db/`. */
export const BACKUPS_DIRNAME = 'backups'

/** Long enough to outwait a normal write, short enough to surface a stuck one. */
export const DEFAULT_BUSY_TIMEOUT_MS = 5_000

export type SqliteStore = Store & {
  /**
   * `PRAGMA data_version`. It changes when **another connection** commits — not
   * for this connection's own writes — which is exactly the signal the server's
   * tailer polls to notice that the CLI wrote something (KC-0005).
   */
  dataVersion(): number
  /** Absolute path of the database file. */
  readonly file: string
}

export type SqliteStoreOptions = {
  /** The stage directory: it holds `retro.db` (KC-0013). */
  readonly dataDir: string
  /**
   * Where pre-migration snapshots go. The caller places them, because the
   * layout above the stage is the caller's (the CLI puts them in the root's
   * `backups/db/`); omitted, they sit beside the database.
   */
  readonly backupsDir?: string
  readonly clock?: Clock
  readonly busyTimeoutMs?: number
  /** Default `true`. `false` hands an unmigrated database to a test that drives the migrator itself. */
  readonly migrate?: boolean
}

/**
 * Opens a stage (architecture.md §Two processes, one code, one database).
 *
 * Both processes — the server and each short-lived CLI command — open the same
 * file this way, so both apply pending migrations under the same lock and neither
 * needs to know the other exists. Concurrency is the storage layer's job here:
 * WAL so a reader never blocks the writer, `busy_timeout` so a second writer
 * waits instead of failing, and one `BEGIN IMMEDIATE` per unit of work.
 */
export function openSqliteStore(options: SqliteStoreOptions): SqliteStore {
  const dataDir = resolve(options.dataDir)
  mkdirSync(dataDir, { recursive: true })

  const file = join(dataDir, DATABASE_FILENAME)
  const db = new Database(file, { create: true })
  const busyTimeout = Math.max(0, Math.trunc(options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS))

  db.run('PRAGMA journal_mode = WAL')
  // Interpolated because SQLite does not bind pragma arguments; the value is our
  // own number, floored to an integer above.
  db.run(`PRAGMA busy_timeout = ${busyTimeout}`)
  db.run('PRAGMA foreign_keys = ON')
  db.run('PRAGMA synchronous = NORMAL')

  if (options.migrate !== false) {
    migrate(db, {
      backupsDir: options.backupsDir ?? join(dataDir, BACKUPS_DIRNAME),
      clock: options.clock ?? systemClock,
    })
  }

  const repositories: Repositories = {
    sessions: new SqliteSessionRepository(db),
    retrospectives: new SqliteRetrospectiveRepository(db),
    revisions: new SqliteRevisionRepository(db),
    recordIds: new SqliteRecordIdRepository(db),
    decisions: new SqliteDecisionRepository(db),
    finishMessages: new SqliteFinishMessageRepository(db),
    holds: new SqliteHoldRepository(db),
    recordLifecycle: new SqliteRecordLifecycleRepository(db),
    labelDefinitions: new SqliteLabelDefinitionRepository(db),
    attributeDefinitions: new SqliteAttributeDefinitionRepository(db),
    recordLabels: new SqliteRecordLabelRepository(db),
    recordAttributeValues: new SqliteRecordAttributeValueRepository(db),
    recordRelations: new SqliteRecordRelationRepository(db),
    recordClaims: new SqliteRecordClaimRepository(db),
    settings: new SqliteSettingRepository(db),
    notes: new SqliteNoteRepository(db),
    annotations: new SqliteAnnotationRepository(db),
    threads: new SqliteCommentThreadRepository(db),
    threadResolutions: new SqliteThreadResolutionRepository(db),
    requests: new SqliteRequestRepository(db),
    events: new SqliteEventRepository(db),
    cursors: new SqliteCursorRepository(db),
  }

  let queue: Promise<unknown> = Promise.resolve()
  let depth = 0
  let closed = false

  /**
   * One unit of work = one `BEGIN IMMEDIATE` (KC-0006).
   *
   * The in-process queue exists because the work is async: between two awaits
   * another caller could otherwise start a second transaction on the same
   * connection, which SQLite would reject as a nested BEGIN. Across processes the
   * write lock and `busy_timeout` do the same job. Re-entrant calls join the
   * transaction already in progress rather than deadlocking behind themselves.
   *
   * Written as a declaration rather than a generic arrow: `<T>(…) =>` is ambiguous
   * with JSX, and the dependency-direction check parses every file as TSX.
   */
  async function tx<T>(work: (repositories: Repositories) => Promise<T>): Promise<T> {
    if (depth > 0) return work(repositories)

    const run = queue.then(async () => {
      db.run('BEGIN IMMEDIATE')
      depth += 1
      try {
        const result = await work(repositories)
        db.run('COMMIT')
        return result
      } catch (error) {
        db.run('ROLLBACK')
        throw error
      } finally {
        depth -= 1
      }
    })
    queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  return {
    ...repositories,
    file,
    tx,
    dataVersion: () =>
      db.query<{ data_version: number }, []>('PRAGMA data_version').get()?.data_version ?? 0,
    close: async () => {
      if (closed) return
      closed = true
      db.close()
    },
  }
}
