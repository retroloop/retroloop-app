import { expect, test } from '@playwright/test'
import { type QueryFamily, staleAfter } from '../src/lib/live'

/**
 * The event → invalidation mapping, checked where it can be checked: as a
 * function, with no browser and no stream.
 *
 * This is the lowest layer the bug it was written for can be expressed at. A
 * settled thread not reaching a second browser is invisible from the acting one
 * — the mutation's own `onSuccess` invalidates `threads.*` there, so the tab
 * that pressed Resolve is always right — and a Gherkin scenario drives exactly
 * one page. Two browser contexts is suite 5's job and suite 5 is capped at three
 * scenarios (testing.md). What is actually wrong in that state is one branch of
 * one pure function, so that is what is asserted.
 *
 * Every case is an exact list rather than a `toContain`: the claim about
 * `RevisionCreated` is that it invalidates **nothing**, and a containment check
 * cannot make it.
 */

const BOTH_COMMENT_QUERIES: readonly QueryFamily[] = ['records', 'threads']

test('a revision the AI just filed makes nothing stale — it is announced, not swapped in', () => {
  expect(staleAfter('RevisionCreated')).toEqual([])
})

test('a comment reaches the panel whichever surface it was written from', () => {
  expect(staleAfter('CommentAdded')).toEqual(BOTH_COMMENT_QUERIES)
})

/**
 * Session 7's bug. Both of these fell to the everything-else branch and
 * invalidated `records.*` alone, which stopped being where a record's threads
 * live when the comments panel became the one comments surface — so a thread
 * settled in one browser never settled in a second one watching the same
 * retrospective.
 */
test('settling a thread reaches a second browser, and so does reopening it', () => {
  expect(staleAfter('ThreadResolved')).toEqual(BOTH_COMMENT_QUERIES)
  expect(staleAfter('ThreadReopened')).toEqual(BOTH_COMMENT_QUERIES)
})

/**
 * `retros` on both is what carries the intermediate status to a page nobody
 * reloaded (session 13). The retrospective's state is a *reading* of these two
 * events now — REVIEWING to SUBMITTED on the finish, SUBMITTED to FINISHED on
 * the close — so an event that stopped invalidating `retros` would leave the
 * review page's header showing the state before the act, with nothing else on
 * the page wrong to give it away. The review page is the surface this reaches:
 * it is the one that subscribes (`useLiveSession`), and the dashboard re-reads
 * on navigation instead.
 */
test('the end of a round refetches the retrospective, either way it went', () => {
  expect(staleAfter('ReviewFinished')).toEqual(['records', 'retros'])
  expect(staleAfter('ReviewClosed')).toEqual(['records', 'retros'])
})

/**
 * **The in-progress marker, going up and coming down** (RL-50).
 *
 * Both land on the everything-else branch, and here that default is the whole
 * mechanism rather than a fallback: the badge is drawn from `records.list`, so
 * `records` is exactly the family that stopped being true — the card re-reads
 * and the badge appears or disappears without a reload. Asserted rather than
 * assumed, because an entry added above them that swallowed these two names
 * would leave the badge frozen on whatever it said when the page loaded, with
 * nothing else on the page wrong to give it away.
 */
test('a record picked up or given back makes the records stale, and only them', () => {
  expect(staleAfter('RecordClaimed')).toEqual(['records'])
  expect(staleAfter('RecordUnclaimed')).toEqual(['records'])
})

/**
 * The names that survive only so a store written before their feature was
 * removed still parses (retro 4 `r-remove-requests`). They must map to something
 * harmless rather than to a crash or a special case.
 */
test('an event nothing raises any more still parses, and changes only the records', () => {
  expect(staleAfter('RequestOpened')).toEqual(['records'])
  expect(staleAfter('ChangesRequested')).toEqual(['records'])
})
