import { expect, test } from '@playwright/test'
import { mockRouter } from './trpc-mock'

/**
 * **Not a mock — a test about the one there is.** The filename deliberately
 * avoids the word: `scripts/check-mock-lock.ts` treats any `mock` segment in a
 * filename as a claim to be a mock module and allows exactly one, which is the
 * guard working. This file imports `trpc-mock.ts` and asserts against it.
 *
 * The two rules the mock has to share with the server about solutions, checked
 * where they can be checked: as calls on the mock, with no browser and no page.
 *
 * This is the lowest layer these can be expressed at, and for one of them it is
 * the **only** layer. `proposed.solutionLevel` on a record that carries
 * solutions has no rendered consumer in the card, and the tab strip did not give
 * it one: the strip reads the *array* — each tab's own level, and the flag that
 * says which one the AI is behind — while the derived ceiling is a summary of
 * that array which nothing on the page prints. It is still on the wire and it is
 * still what `effectiveDecision` seeds a pending record with. A rule with no
 * rendered consumer is exactly the kind that rots quietly, so it is asserted
 * against the mock directly rather than left to the page to notice.
 *
 * The refusals are the other half, and after the tab strip they stand in three
 * different places:
 *
 *   - **the level** is reachable from the page, and load-bearing: deleting
 *     `hasSolutions ||` in `decision-controls.tsx` makes the solutions scenarios
 *     fail, because the mock answers the wrong payload with a `BAD_REQUEST` and
 *     the verdict never lands.
 *   - **the range** is reachable only through a defect in the strip: the Select
 *     control sends the position it was rendered at, so an off-by-one there is
 *     the way a bad index gets sent, and the scenarios catch it because the
 *     refused verdict never lands. This is what makes the guard falsifiable
 *     rather than decorative.
 *   - **a selection on a record that proposes none** is unreachable from the
 *     page by construction — the strip renders only where `solutions` is
 *     non-null, and `record-card.tsx` passes `null` for the pick everywhere
 *     else. Nothing in the UI can provoke it, which is why it is pinned here and
 *     nowhere else.
 *
 * Every message below is the server's own string
 * (`record-decision.use-case.ts`), so a mock that drifted into refusing for a
 * different reason, or with different wording, fails here.
 */

const RETRO_ID = 1
/** The record the fixture files with three solutions — L1, L2 recommended, L4. */
const SOLUTIONS_RID = 'r-stale-lock'
/** One of the two filed in the shape that predates solutions. */
const LEGACY_RID = 'r-bullet-responses'

const decide = (input: Record<string, unknown>) =>
  mockRouter['decisions.record']({
    retroId: RETRO_ID,
    rid: SOLUTIONS_RID,
    revision: 1,
    state: 'approved',
    ...input,
  } as Parameters<(typeof mockRouter)['decisions.record']>[0])

test('the proposed level is the recommended solution’s, not the first one’s', () => {
  const detail = mockRouter['records.get']({ retroId: RETRO_ID, rid: SOLUTIONS_RID })

  // The fixture's solutions are L1, L2 (recommended) and L4, so the first, the
  // last and the recommended are three different levels — which is the whole
  // reason the recommendation sits in the middle. A page or a mock reading
  // position 0 answers 1, one reading the end answers 4, and only one reading
  // the flag answers 2.
  expect(detail.record.solutions?.map((solution) => solution.level)).toEqual([1, 2, 4])
  expect(detail.record.solutions?.map((solution) => solution.recommended)).toEqual([
    false,
    true,
    false,
  ])
  expect(detail.record.proposed.solutionLevel).toBe(2)

  // And a pending record shows that same level as the decision in effect.
  expect(detail.decision.state).toBe('pending')
  expect(detail.decision.solutionLevel).toBe(2)
  expect(detail.decision.selectedSolution).toBe(2)
})

test('a record filed before solutions keeps the level its draft authored', () => {
  const detail = mockRouter['records.get']({ retroId: RETRO_ID, rid: LEGACY_RID })

  expect(detail.record.solutions).toBeNull()
  expect(detail.record.proposed.solutionLevel).toBe(1)
  expect(detail.decision.selectedSolution).toBeNull()
})

test('a level sent for a record whose level comes from its pick is refused', () => {
  expect(() => decide({ solutionLevel: 4 })).toThrow(
    `the level of record ${SOLUTIONS_RID} is the level of the solution selected; send selectedSolution instead`,
  )
})

test('a selection past the end of the array is refused', () => {
  expect(() => decide({ selectedSolution: 9 })).toThrow(
    `record ${SOLUTIONS_RID} proposes 3 solution(s); 9 is not one of them`,
  )
})

/**
 * One past the end, which is the shape a real defect takes: the tab strip is
 * built from the array, so the way it sends an index nothing points at is an
 * off-by-one, not a 9. The refusal has to catch the near miss as well as the
 * absurd one, or the guard tells the page nothing about the mistake it can
 * actually make.
 */
test('one past the end is refused too, not rounded down to the last', () => {
  expect(() => decide({ selectedSolution: 4 })).toThrow(
    `record ${SOLUTIONS_RID} proposes 3 solution(s); 4 is not one of them`,
  )
})

test('a selection sent for a record that proposes none is refused', () => {
  expect(() =>
    mockRouter['decisions.record']({
      retroId: RETRO_ID,
      rid: LEGACY_RID,
      revision: 1,
      state: 'approved',
      selectedSolution: 1,
    } as Parameters<(typeof mockRouter)['decisions.record']>[0]),
  ).toThrow(`record ${LEGACY_RID} proposes no solutions to select between`)
})

/**
 * Each refusal is a `BAD_REQUEST` the way the real error map shapes one, not a
 * bare `Error`: the page's error handling reads the code, so a mock that threw
 * something shaped differently would make a scenario about a refusal pass for
 * the wrong reason.
 */
test('a refusal is shaped like the server’s BAD_REQUEST', () => {
  try {
    decide({ solutionLevel: 4 })
    throw new Error('the mock accepted a level it should have refused')
  } catch (error) {
    const data = (error as { data?: { code?: string; httpStatus?: number } }).data
    expect(data?.code).toBe('BAD_REQUEST')
    expect(data?.httpStatus).toBe(400)
  }
})
