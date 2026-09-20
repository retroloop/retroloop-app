import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadExportSchema, validate } from '../support/json-schema'

/**
 * The documents the contract exists for: retrospectives exported by earlier
 * versions of the product, validated against the schema as it stands now.
 *
 * The point of `export.v1` being `additionalProperties: false` is that a key
 * removed from it invalidates every document written while it existed — so the
 * change that stopped emitting `agreedDirection` and `footprint` had to move
 * them out of `required` and leave them in the contract, exactly as
 * `held`/`holdNote` were left (data-model.md §Hold). This is the check that says
 * it worked, against documents a real export wrote rather than against one this
 * suite built for itself.
 *
 * **The fixtures travel with the repository**, in `test/fixtures/historical-exports`,
 * resolved relative to this file so the suite runs the same on every machine.
 * They are sanitized copies: structure, keys, types, enum values, numbers,
 * booleans, timestamps and array lengths exactly as exported, with the free text
 * replaced by neutral filler of the same length. The set is a small one that
 * covers every shape the format has had —
 *
 *   - `agreedDirection` + `footprint` records, with no retrospective `title`
 *   - a retrospective `title`, and threads on `defaults`/`footprint`/`root_cause`
 *   - `held` + `holdNote`, a `declined` record, and review-level threads
 *   - `solutions` + `selectedSolution` in place of the single direction
 *   - `finishMessages`, and threads carrying `resolved` and a message `revision`
 *   - `globalId` on every record
 *   - a `humanWords` entry with no `context`
 *
 * **Read-only, and never skipped.** No test writes to them, and a missing or
 * empty directory fails rather than passes: a suite green because its inputs
 * vanished asserts nothing at all.
 */
const EXPORTS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'historical-exports',
)
const schema = loadExportSchema()

function exportFiles(): readonly string[] {
  if (!existsSync(EXPORTS_DIR)) return []
  return readdirSync(EXPORTS_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
}

function documents(): readonly Record<string, unknown>[] {
  return exportFiles().map(
    (name) => JSON.parse(readFileSync(join(EXPORTS_DIR, name), 'utf8')) as Record<string, unknown>,
  )
}

describe('the retrospectives already exported', () => {
  const files = exportFiles()

  test('are checked in beside this suite', () => {
    expect({ exists: existsSync(EXPORTS_DIR), count: files.length > 0 }).toEqual({
      exists: true,
      count: true,
    })
  })

  test('are all still valid against export.v1', () => {
    expect(files.length).toBeGreaterThanOrEqual(1)

    for (const name of files) {
      const document: unknown = JSON.parse(readFileSync(join(EXPORTS_DIR, name), 'utf8'))
      expect({ name, problems: validate(document, schema, schema) }).toEqual({ name, problems: [] })
    }
  })

  test('still carry the two keys nothing writes any more', () => {
    // The reason they are optional rather than gone. If a future change lets
    // this become vacuous — every historical document rewritten into the new
    // shape — the assertion below fails rather than passing silently.
    const legacy = documents()
      .flatMap((document: { records?: { agreedDirection?: string }[] }) => document.records ?? [])
      .filter((record) => record.agreedDirection !== undefined)

    expect(legacy.length).toBeGreaterThan(0)
  })

  test('cover every shape the format has had', () => {
    const records = documents().flatMap(
      (document: { records?: Record<string, unknown>[] }) => document.records ?? [],
    )
    const retrospectives = documents().map(
      (document: { retrospective?: Record<string, unknown> }) => document.retrospective ?? {},
    )
    const threads = [
      ...records.flatMap((record) => (record.threads ?? []) as Record<string, unknown>[]),
      ...documents().flatMap(
        (document: { reviewThreads?: Record<string, unknown>[] }) => document.reviewThreads ?? [],
      ),
    ]

    const present = {
      agreedDirection: records.some((record) => record.agreedDirection !== undefined),
      footprint: records.some((record) => record.footprint !== undefined),
      held: records.some((record) => record.held !== undefined),
      holdNote: records.some((record) => record.holdNote !== undefined),
      solutions: records.some((record) => record.solutions !== undefined),
      selectedSolution: records.some((record) => record.selectedSolution !== undefined),
      globalId: records.some((record) => record.globalId !== undefined),
      declined: records.some((record) => record.state === 'declined'),
      untitled: retrospectives.some((retrospective) => retrospective.title === undefined),
      titled: retrospectives.some((retrospective) => typeof retrospective.title === 'string'),
      finishMessages: retrospectives.some(
        (retrospective) => retrospective.finishMessages !== undefined,
      ),
      resolvedThread: threads.some((thread) => thread.resolved !== undefined),
      unresolvableThread: threads.some((thread) => thread.resolved === undefined),
      wordsWithoutContext: records
        .flatMap((record) => (record.humanWords ?? []) as Record<string, unknown>[])
        .some((words) => words.context === undefined),
    }

    expect(present).toEqual({
      agreedDirection: true,
      footprint: true,
      held: true,
      holdNote: true,
      solutions: true,
      selectedSolution: true,
      globalId: true,
      declined: true,
      untitled: true,
      titled: true,
      finishMessages: true,
      resolvedThread: true,
      unresolvableThread: true,
      wordsWithoutContext: true,
    })
  })
})
