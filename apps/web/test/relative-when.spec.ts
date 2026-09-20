import { expect, test } from '@playwright/test'
import { relativeWhen } from '../src/lib/relative-when'

/**
 * Direction 4's relative half — dates are relative when they are not
 * too far off — proved **here rather than in the browser**, and the reason is a
 * flake that nearly shipped.
 *
 * The diary's dates come from the mock's `FIXED_TIME`, a constant
 * (`2026-08-24T09:00:00.000Z`). A scenario asserting the rendered form would have
 * read `relative` for the first six days of that constant's life and `absolute`
 * from the seventh — green when written, red a few days later, for no change to
 * any code. A test whose result depends on the wall clock is not a test of the
 * behaviour; it is a test of when you ran it.
 *
 * So the boundary is proved where it is deterministic. `relativeWhen` takes `now`
 * as a parameter precisely for this, and `form` is the assertable half: which side
 * of the week an instant falls on is a decision, and the formatted string is a
 * rendering of the reader's locale that `lib/when.ts` already established nothing
 * asserts. The browser scenarios read the `<time dateTime>` attribute instead,
 * which is the machine-readable half and is stable forever.
 *
 * Both directions of the boundary are here, and so is each unit's threshold,
 * because "relative when recent" is two claims — that near instants are relative
 * *and* that far ones are not — and a function that returned `relative` for
 * everything would satisfy a suite that only checked the near half.
 */

const NOW = new Date('2026-08-28T12:00:00.000Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

test('an instant inside the week is relative', () => {
  expect(relativeWhen(ago(3 * DAY), NOW).form).toBe('relative')
})

/**
 * The far side, and the value that pins the boundary itself: six days is inside,
 * seven is outside. Asserted as a pair, because a boundary tested only from one
 * side is a boundary whose position nothing checks — an implementation that
 * flipped at one day or at one year would pass either assertion alone.
 */
test('the boundary is a week — six days in, seven days out', () => {
  expect(relativeWhen(ago(6 * DAY), NOW).form).toBe('relative')
  expect(relativeWhen(ago(7 * DAY), NOW).form).toBe('absolute')
})

/**
 * Each unit changes at its own threshold. The rounding is **towards the smaller
 * unit**: 25 hours is a day and not two, because overstating the distance is the
 * error that makes a diary look wrong to the person who wrote it.
 */
test('it steps down through the units rather than rounding up', () => {
  expect(relativeWhen(ago(30 * SECOND), NOW).text).toBe(relativeWhen(ago(0), NOW).text)
  expect(relativeWhen(ago(90 * MINUTE), NOW).form).toBe('relative')
  expect(relativeWhen(ago(25 * HOUR), NOW).form).toBe('relative')
})

/**
 * A stamp in the future is clock skew between two machines, not a reading, and an
 * hour of it is ordinary. The boundary is symmetric so that skew inside the week
 * still renders as a relative moment rather than falling through to a date, and
 * skew beyond it falls back like any far instant.
 */
test('clock skew inside the week is still relative, and beyond it is not', () => {
  const ahead = (ms: number) => new Date(NOW.getTime() + ms).toISOString()
  expect(relativeWhen(ahead(2 * HOUR), NOW).form).toBe('relative')
  expect(relativeWhen(ahead(8 * DAY), NOW).form).toBe('absolute')
})

/**
 * Cannot arrive through the product — every date on the wire is an ISO-8601
 * instant — which is exactly why the fallback shows **what arrived** instead of
 * printing "Invalid Date". A reader who sees the raw string can report it; a
 * reader who sees "Invalid Date" has been told only that something is broken.
 */
test('an unparseable stamp is reported as itself, not as Invalid Date', () => {
  const when = relativeWhen('not a date', NOW)
  expect(when.form).toBe('unparseable')
  expect(when.text).toBe('not a date')
})
