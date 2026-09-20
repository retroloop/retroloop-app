import { expect, test } from '@playwright/test'
import type { AppRouterOutputs } from '@retro/api'
import { cwdBasename, retroIdentityLine, retroName } from '../src/lib/retro-identity'

/**
 * The retro's name and its identity line (N1/N3).
 *
 * The lowest layer that can express these: they are pure string work over a row
 * the server already proves it produces, and the browser scenarios then assert
 * the *rendered* line matches — so the cases that only differ by their data
 * (an unnamed retro, an awkward path) are settled here rather than by inventing
 * fixture worlds (testing.md §The lowest layer that can express it).
 *
 * Typed as the real dashboard row so a shape change fails here at compile time.
 */
type Row = AppRouterOutputs['retros']['list'][number]

const ROW: Row = {
  retroId: 7,
  retroNumber: 2,
  title: 'The lock that outlived its process',
  state: 'reviewing',
  counts: { pending: 1, decided: 2 },
  session: { id: 3, cwd: '/Users/sample/Developer/retro', startedAt: '2026-08-24T09:00:00.000Z' },
}

test('the name is what the latest revision called it', () => {
  expect(retroName(ROW)).toBe('The lock that outlived its process')
})

/**
 * **The fallback prints the GLOBAL id** (D5: untitled retros show the
 * global id as fallback), and this fixture is what makes the assertion
 * mean something: `ROW` carries `retroId: 7` and `retroNumber: 2`, two different
 * numbers, so a fallback that had gone back to the per-session number reads
 * `Retro #2 — retro` and fails here rather than passing on a coincidence.
 *
 * Still never a bare number — the directory stays — and still
 * the same one definition three surfaces read, which is why it is asserted at this
 * layer instead of once per page.
 */
test('an unnamed retro reads as its global id and its directory, never a bare number', () => {
  expect(retroName({ ...ROW, title: null })).toBe('Retro 7 — retro')
})

/**
 * The home page shows "Session #X · Retro #Y" rather than "Retro #1 ·
 * Session 1". Session first, because a
 * retrospective is the *n*th of a session and not the other way round. The two
 * ordinals differ here — session 3, retro #2 — so the order is what this asserts
 * rather than which number happened to land where.
 */
test('the identity line is the session, the ordinal and the directory', () => {
  expect(retroIdentityLine(ROW)).toBe('Session 3 · Retro #2 · /Users/sample/Developer/retro')
})

/**
 * `cwd` comes from Claude Code rather than from anything this product writes, so
 * the awkward shapes are worth pinning: a trailing slash is a trailing slash and
 * not an unnamed directory, and the root has no segment to take.
 */
test('the directory is the last segment, whatever the path looks like', () => {
  expect(cwdBasename('/Users/sample/Developer/retro/')).toBe('retro')
  expect(cwdBasename('/Users/sample/Developer/retro///')).toBe('retro')
  expect(cwdBasename('retro')).toBe('retro')
  expect(cwdBasename('/')).toBe('/')
})
