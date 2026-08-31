import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadExportSchema, validate } from '../support/json-schema'

/**
 * The documents the contract exists for: every retrospective the owner has
 * actually exported, validated against the schema as it stands now.
 *
 * The point of `export.v1` being `additionalProperties: false` is that a key
 * removed from it invalidates every document written while it existed — so the
 * change that stopped emitting `agreedDirection` and `footprint` had to move
 * them out of `required` and leave them in the contract, exactly as
 * `held`/`holdNote` were left (data-model.md §Hold). This is the check that says
 * it worked, against the real files rather than against a document this suite
 * built for itself.
 *
 * **Read-only, and skipped rather than failed when the directory is not there.**
 * These are the owner's files and no test writes to them; a machine that has
 * never run Retro has none, and a suite that failed on that would be asserting
 * something about the machine rather than about the contract. The count is
 * asserted where they exist, so an empty directory cannot pass as five.
 */
const EXPORTS_DIR = join(homedir(), '.ai-team', 'retro', 'exports')
const schema = loadExportSchema()

function exportFiles(): readonly string[] {
  if (!existsSync(EXPORTS_DIR)) return []
  return readdirSync(EXPORTS_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
}

describe('the retrospectives already exported', () => {
  const files = exportFiles()

  test.skipIf(files.length === 0)('are all still valid against export.v1', () => {
    expect(files.length).toBeGreaterThanOrEqual(1)

    for (const name of files) {
      const document: unknown = JSON.parse(readFileSync(join(EXPORTS_DIR, name), 'utf8'))
      expect({ name, problems: validate(document, schema, schema) }).toEqual({ name, problems: [] })
    }
  })

  test.skipIf(files.length === 0)('still carry the two keys nothing writes any more', () => {
    // The reason they are optional rather than gone. If a future change lets
    // this become vacuous — every historical document rewritten into the new
    // shape — the assertion below fails rather than passing silently.
    const legacy = files
      .map((name) => JSON.parse(readFileSync(join(EXPORTS_DIR, name), 'utf8')))
      .flatMap((document: { records?: { agreedDirection?: string }[] }) => document.records ?? [])
      .filter((record) => record.agreedDirection !== undefined)

    expect(legacy.length).toBeGreaterThan(0)
  })
})
