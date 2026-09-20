import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as api from '@retro/api'

const SERVER = join(import.meta.dir, '../src/server.ts')

/**
 * One composition root, and it is not here.
 *
 * `@retro/api` assembles a mounted handler; the CLI's `serve` command owns the
 * process — it takes the stage lock before anything migrates or binds, and holds
 * its store handles for the life of the server rather than one command's. This
 * package once carried a `serve()` that did the same job differently and had no
 * caller at all; it was found by planting a skipped-migration defect in it and
 * watching every e2e scenario pass, which is what an unreachable second answer
 * to "how does the server start" buys you.
 *
 * So this test guards the shape rather than a behaviour: the moment something
 * here opens a store or binds a port again, the duplicate is back.
 */
describe('the api package', () => {
  test('exports nothing that starts a server', () => {
    const listening = Object.keys(api).filter((name) => /^(serve|start|listen|run)/.test(name))

    expect(listening, `@retro/api should hand over a handler, not a running server`).toEqual([])
  })

  test('assembles no store and binds no port', () => {
    const source = readFileSync(SERVER, 'utf8')

    // `createServerRuntime` takes an App and an EventSource already open. Opening
    // one here would mean deciding where the stage is, which belongs to the
    // composition root and nowhere else.
    //
    // Asserted a token at a time: `not.toContain` on a whole file prints the whole
    // file when it fails, and the useful half of that report is the one word.
    for (const forbidden of ['openSqliteStore', 'createApp(', 'Bun.serve']) {
      expect(
        source.includes(forbidden),
        `server.ts uses ${forbidden} — a second composition root is back`,
      ).toBe(false)
    }
  })
})
