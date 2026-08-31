import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  openSqliteStore,
  type SqliteStore,
  type SqliteStoreOptions,
} from '#infrastructure/sqlite/sqlite-store.adapter'
import { createFakeClock } from './fake-clock'

/**
 * A throwaway stage per test (testing.md §Determinism).
 *
 * A stage is a directory, so an isolated one is `mkdtemp` — no shared file, no
 * ordering between tests, and the real `retro.db`/`backups/` layout the product
 * uses rather than an in-memory special case.
 */
const stages: string[] = []

export function createTempStage(): string {
  const dir = mkdtempSync(join(tmpdir(), 'retro-stage-'))
  stages.push(dir)
  return dir
}

export function openTempStore(options: Partial<SqliteStoreOptions> = {}): SqliteStore {
  return openSqliteStore({
    dataDir: options.dataDir ?? createTempStage(),
    clock: options.clock ?? createFakeClock(),
    ...options,
  })
}

/** Call from `afterAll`; leaving temp databases behind is litter, not evidence. */
export function removeTempStages(): void {
  for (const dir of stages.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
}
