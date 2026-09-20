import { Database } from 'bun:sqlite'
import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MIGRATIONS, migrate } from '@retro/core'

import { createDefaultRuntime } from '#runtime'
import { resolveStage } from '#stage'

/**
 * Where a pre-migration snapshot lands.
 *
 * The migrator takes the snapshot; the CLI decides where it goes, and since the
 * root folder owns `backups/db/` the snapshot must leave the stage directory.
 * This is the lowest layer that can express it: the production composition —
 * `createDefaultRuntime().openStore` — over a real database that has a migration
 * pending, because a fresh database is never snapshotted at all.
 */
const roots: string[] = []

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

/** A stage whose database is real, populated, and one batch behind the registry. */
function anOutdatedStage(): string {
  const root = mkdtempSync(join(tmpdir(), 'retro-root-'))
  roots.push(root)

  const dataDir = join(root, 'data')
  mkdirSync(dataDir, { recursive: true })

  const db = new Database(join(dataDir, 'retro.db'), { create: true })
  migrate(db, { registry: MIGRATIONS.slice(0, 2) })
  db.run(
    `INSERT INTO sessions (claude_session, project, cwd, branch, supervised, started_at)
     VALUES ('uuid-old', 'retro', '/tmp', 'main', 1, '2026-01-01T00:00:00.000Z')`,
  )
  db.close()

  return root
}

describe('the pre-migration backup', () => {
  test('lands in <root>/backups/db, not inside the stage', async () => {
    const root = anOutdatedStage()
    const runtime = createDefaultRuntime({ env: {}, cwd: root })

    const store = runtime.openStore(resolveStage({ home: root, env: {} }))
    await store.close()

    const backups = join(root, 'backups', 'db')
    expect(existsSync(backups)).toBe(true)
    expect(readdirSync(backups)).toHaveLength(1)
    expect(existsSync(join(root, 'data', 'backups'))).toBe(false)
  })
})
