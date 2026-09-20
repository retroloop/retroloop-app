/**
 * A moment, as a reader reads it — **relative while it is still recent, absolute
 * once it is not.**
 *
 * The rule for the diary view: dates are relative when they
 * are not too far off. The two halves of that rule
 * are both instructions. "Relative" is the near case, because the reading the
 * diary is arranged for is "what was I doing in the last few days" and
 * "yesterday" answers it in one word where "Aug 26, 2026, 6:22 AM" makes the
 * reader do the subtraction. "When they are not too far off" is the far case: at
 * some distance a relative stamp stops being an answer and becomes a riddle —
 * "3 weeks ago" is not a date anybody can place, and a diary that only ever said
 * that would be a diary with no dates in it.
 *
 * So there is a **boundary**, and it is a week. Inside it the reader still holds
 * the days in their head and the relative form is the shorter true sentence;
 * outside it they do not, and the absolute form is. A week is also the span the
 * relative words can cover without inventing a unit — days up to six, and then
 * the next word would have to be "weeks", which is where the riddle starts.
 *
 * `Intl.RelativeTimeFormat` writes the near half rather than a table of strings
 * of ours, for the reason `lib/when.ts` gives about `Intl.DateTimeFormat`: the
 * reader's own locale, and "yesterday" instead of "1 day ago" for free
 * (`numeric: 'auto'`). Both formatters are built once — a diary builds one line
 * per sitting and a corpus chart one per point.
 *
 * **Nothing asserts the formatted string**, on `lib/when.ts`'s precedent: the
 * text depends on the machine's locale and a scenario pinned to one rendering of
 * it would be a scenario about the CI box. What is provable without a browser is
 * the *choice* — which half of the boundary an instant falls on, given a clock —
 * and that is what `relativeWhen` returns as data.
 */

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
/** The far half. Date only: the hour of something a week old is not the reading. */
const ABSOLUTE = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

/** Six days and change — see the header for why the boundary is a week. */
const RECENT_MS = 7 * 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const MINUTE_MS = 60 * 1000

/**
 * Which form an instant takes, and the text of it.
 *
 * `form` is the assertable half: `'relative'` inside the boundary,
 * `'absolute'` outside it, and `'unparseable'` for a string that is not a date
 * — which cannot arrive through the product, every date on the wire being an
 * ISO-8601 instant, and is exactly why the fallback shows what arrived rather
 * than printing "Invalid Date".
 */
export type When = {
  readonly form: 'relative' | 'absolute' | 'unparseable'
  readonly text: string
}

/**
 * `now` is a parameter and not `Date.now()`, so the boundary is provable: a test
 * hands it a clock and reads back which side of the week an instant fell on. The
 * caller in the browser passes the real one.
 *
 * Rounding is **towards the smaller unit, never up**. An instant 25 hours old is
 * "yesterday" and not "2 days ago": the reader's day boundary is not what this
 * function can see, and overstating the distance is the error that makes a diary
 * look wrong to the person who wrote it.
 */
export function relativeWhen(iso: string, now: Date): When {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return { form: 'unparseable', text: iso }

  const elapsed = now.getTime() - at.getTime()

  // A stamp in the future is a clock skew, not a reading — an hour of it is
  // ordinary between two machines. Past the boundary in either direction the
  // absolute form is the honest one, and `Math.abs` is what makes the boundary
  // symmetric rather than only guarding one side of it.
  if (Math.abs(elapsed) >= RECENT_MS) return { form: 'absolute', text: ABSOLUTE.format(at) }

  const sign = elapsed < 0 ? 1 : -1
  const magnitude = Math.abs(elapsed)

  if (magnitude < MINUTE_MS) return { form: 'relative', text: RELATIVE.format(0, 'second') }
  if (magnitude < HOUR_MS) {
    return {
      form: 'relative',
      text: RELATIVE.format(sign * Math.floor(magnitude / MINUTE_MS), 'minute'),
    }
  }
  if (magnitude < 24 * HOUR_MS) {
    return {
      form: 'relative',
      text: RELATIVE.format(sign * Math.floor(magnitude / HOUR_MS), 'hour'),
    }
  }
  return {
    form: 'relative',
    text: RELATIVE.format(sign * Math.floor(magnitude / (24 * HOUR_MS)), 'day'),
  }
}
