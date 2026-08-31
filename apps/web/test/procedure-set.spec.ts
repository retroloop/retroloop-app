import { expect, test } from '@playwright/test'
import { MOCK_PROCEDURE_PATHS, type ProcedurePath } from './trpc-mock'

/**
 * The web half of the procedure-set meta-test (testing.md §R-MOCK-LOCK). The
 * server half is `apps/api/test/procedures.test.ts`, which asserts the same
 * twenty-nine against the real router; between them, the mock cannot quietly
 * drift from the thing it stands in for.
 *
 * Twenty-nine, and the word and the list are checked against each other by the
 * reader alone — so when one moves, move the other.
 *
 * `ProcedurePath` is computed from `AppRouter`, so this list is not a second
 * opinion about the router — it is the router's own answer, written down where a
 * reviewer can read it.
 *
 * **Two levels, always.** `ProcedurePath` is `${namespace}.${procedure}`, so a
 * nested sub-router would make this list disagree with `_def.procedures` on the
 * server side — `records.lifecycle.set` keys as three segments there and as the
 * unreachable `records.lifecycle` here. That is why the session-8 lifecycle
 * write is `records.setLifecycle` and not the `records.lifecycle.set` the design
 * brief sketched — and why session 10's toggle is `settings.setAiConfigWrite`
 * rather than a `settings.aiConfigWrite.set` that would have read better and
 * broken this list.
 */
const EXPECTED_PATHS = [
  'attributes.define',
  'attributes.list',
  'attributes.rename',
  'attributes.retire',
  'attributes.set',
  // The un-retire pair, session 12 (retro-11 `r-retire-burns-a-word`).
  'attributes.unretire',
  'decisions.record',
  'events.onRetro',
  'labels.define',
  'labels.list',
  'labels.rename',
  'labels.retire',
  'labels.set',
  'labels.unretire',
  'records.byId',
  'records.get',
  'records.list',
  'records.listAll',
  // Session 11's relation (session 13). One procedure for relate and un-relate,
  // on `records.setLifecycle`'s own standing.
  'records.relate',
  'records.setLifecycle',
  'retros.get',
  'retros.list',
  'review.finish',
  'settings.get',
  'settings.setAiConfigWrite',
  'threads.list',
  'threads.open',
  'threads.reply',
  'threads.resolve',
] as const satisfies readonly ProcedurePath[]

/** Empty exactly while the list above names every procedure the router has. */
type Uncovered = Exclude<ProcedurePath, (typeof EXPECTED_PATHS)[number]>

test('the mock covers the real router key for key', () => {
  // A procedure added to the router and not to this list makes `Uncovered` a
  // real union, and `Uncovered[]` stops being assignable to `never[]`. The
  // failure is a compile error, before this test ever runs.
  const uncovered: never[] = [] as Uncovered[]
  expect(uncovered).toEqual([])

  // And the mock object itself has those keys and no others — which the
  // `satisfies MockRouter` in the mock already guarantees at compile time, and
  // this confirms against the thing that actually ships.
  expect([...MOCK_PROCEDURE_PATHS]).toEqual([...EXPECTED_PATHS].sort())
})
