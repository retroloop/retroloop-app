import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTempStage, removeTempStages } from '../support/temp-stage'

afterAll(removeTempStages)

/**
 * The dev script that scaffolds a migration **and registers it** (migrations.md).
 *
 * Both halves matter: the registry is static because a compiled binary cannot glob
 * a directory, so a migration nobody imported is a migration that silently does
 * not exist. The script is exercised as a process, against a throwaway directory,
 * so the test proves the real command rather than a re-implementation of it.
 */
const SCRIPT = join(import.meta.dir, '../../../../scripts/make-migration.ts')

const SEED_INDEX = `import type { Migration } from '#infrastructure/sqlite/migration'
import { migration as createSessions } from '#infrastructure/sqlite/migrations/20260823120000_create_sessions'

export const MIGRATIONS: readonly Migration[] = [
  createSessions,
]
`

type Result = { exitCode: number; stderr: string }

async function makeMigration(dir: string, args: string[]): Promise<Result> {
  const child = Bun.spawn(['bun', 'run', SCRIPT, ...args, '--dir', dir], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stderr = await new Response(child.stderr).text()
  return { exitCode: await child.exited, stderr }
}

describe('make:migration', () => {
  let dir: string

  beforeEach(() => {
    dir = join(createTempStage(), 'migrations')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'index.ts'), SEED_INDEX)
  })

  test('scaffolds a migration with a mandatory up and down', async () => {
    const result = await makeMigration(dir, ['add_export_cursor', '--at', '20260824090000'])

    expect(result.exitCode).toBe(0)
    const scaffold = readFileSync(join(dir, '20260824090000_add_export_cursor.ts'), 'utf8')
    expect(scaffold).toContain("version: '20260824090000'")
    expect(scaffold).toContain("name: 'add_export_cursor'")
    expect(scaffold).toContain('up(db)')
    expect(scaffold).toContain('down(db)')
  })

  test('registers it in the static registry, in version order', async () => {
    await makeMigration(dir, ['add_export_cursor', '--at', '20260824090000'])
    await makeMigration(dir, ['drop_legacy_flag', '--at', '20260825101500'])

    const index = readFileSync(join(dir, 'index.ts'), 'utf8')
    expect(index).toContain(
      "import { migration as addExportCursor } from '#infrastructure/sqlite/migrations/20260824090000_add_export_cursor'",
    )
    expect(index).toContain(
      "import { migration as dropLegacyFlag } from '#infrastructure/sqlite/migrations/20260825101500_drop_legacy_flag'",
    )
    expect(index).toContain('  createSessions,\n  addExportCursor,\n  dropLegacyFlag,\n]')
  })

  test('refuses to register the same migration twice', async () => {
    await makeMigration(dir, ['add_export_cursor', '--at', '20260824090000'])

    const result = await makeMigration(dir, ['add_export_cursor', '--at', '20260826000000'])

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('already in the registry')
  })

  test('refuses a name that would not make a legal symbol', async () => {
    const result = await makeMigration(dir, ['Add Export Cursor'])

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('lower_snake_case')
  })

  test('refuses a directory with no registry to append to', async () => {
    const empty = join(createTempStage(), 'nowhere')
    mkdirSync(empty, { recursive: true })

    const result = await makeMigration(empty, ['add_export_cursor', '--at', '20260824090000'])

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('does not exist')
  })
})
