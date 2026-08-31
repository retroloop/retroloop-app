#!/usr/bin/env bun
/**
 * `make:migration` — scaffold a migration and register it (migrations.md).
 *
 * Usage:
 *   bun run scripts/make-migration.ts <name> [--dir <migrations-dir>] [--at <YYYYMMDDHHmmss>]
 *
 * It writes `<version>_<name>.ts` and appends the migration to `index.ts`, because
 * the registry is static: a compiled binary cannot glob a directory, so a
 * migration that is not imported by name does not exist. Doing both halves in one
 * command is the point — a scaffolded-but-unregistered migration is the failure
 * this script exists to prevent.
 *
 * `--dir` and `--at` exist so the script can be tested against a throwaway
 * directory at a fixed timestamp rather than by writing into the real one.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DEFAULT_DIR = new URL(
  '../packages/core/src/infrastructure/sqlite/migrations',
  import.meta.url,
).pathname

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

function fail(message: string): never {
  console.error(`make:migration: ${message}`)
  process.exit(2)
}

/** `20260823143000` — the version is the filename prefix, and it sorts into apply order. */
function stamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join('')
}

function toSymbol(name: string): string {
  return name
    .split(/[_-]+/)
    .filter((part) => part.length > 0)
    .map((part, index) =>
      index === 0 ? part.toLowerCase() : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
    )
    .join('')
}

export function renderMigration(version: string, name: string): string {
  return `import type { Migration } from '#infrastructure/sqlite/migration'

export const migration: Migration = {
  version: '${version}',
  name: '${name}',

  up(db) {
    db.exec(\`
      -- TODO: the schema change. Additive-first: ship new columns and tables
      -- before the code that depends on them (migrations.md).
    \`)
  },

  down(db) {
    db.exec(\`
      -- TODO: reverse exactly what up() did. Mandatory: a migration nobody can
      -- reverse is a migration nobody can test.
    \`)
  },
}
`
}

/**
 * Adds the import and the array entry. The registry stays sorted because a new
 * version is always the newest, so both insertions go last.
 */
export function registerInIndex(
  source: string,
  version: string,
  name: string,
  symbol: string,
): string {
  if (source.includes(`'${symbol}'`) || source.includes(` ${symbol},`)) {
    fail(`${symbol} is already in the registry`)
  }

  const importLine = `import { migration as ${symbol} } from '#infrastructure/sqlite/migrations/${version}_${name}'`
  const imports = [...source.matchAll(/^import \{ migration as .+$/gm)]
  const lastImport = imports.at(-1)
  const withImport =
    lastImport === undefined
      ? `${importLine}\n${source}`
      : `${source.slice(0, lastImport.index + lastImport[0].length)}\n${importLine}${source.slice(
          lastImport.index + lastImport[0].length,
        )}`

  const array = /(export const MIGRATIONS: readonly Migration\[\] = \[)([\s\S]*?)(\n\])/
  if (!array.test(withImport)) fail('could not find the MIGRATIONS array in index.ts')

  return withImport.replace(
    array,
    (_match, open, body, close) => `${open}${body}\n  ${symbol},${close}`,
  )
}

const name = process.argv[2]
if (name === undefined || name.startsWith('--')) {
  fail('usage: bun run scripts/make-migration.ts <name> [--dir <dir>] [--at <YYYYMMDDHHmmss>]')
}
if (!/^[a-z][a-z0-9_]*$/.test(name)) {
  fail(`name must be lower_snake_case, got ${JSON.stringify(name)}`)
}

const dir = flag('dir') ?? DEFAULT_DIR
const version = flag('at') ?? stamp(new Date())
if (!/^\d{14}$/.test(version)) fail(`--at must be 14 digits (YYYYMMDDHHmmss), got ${version}`)

mkdirSync(dir, { recursive: true })
const file = join(dir, `${version}_${name}.ts`)
if (existsSync(file)) fail(`${file} already exists`)

const indexFile = join(dir, 'index.ts')
if (!existsSync(indexFile)) fail(`${indexFile} does not exist — is --dir right?`)

writeFileSync(file, renderMigration(version, name))
writeFileSync(
  indexFile,
  registerInIndex(readFileSync(indexFile, 'utf8'), version, name, toSymbol(name)),
)

console.log(`make:migration: created ${file}`)
console.log(`make:migration: registered ${toSymbol(name)} in ${indexFile}`)
console.log('make:migration: write up() and down(), then run the suite.')
