/**
 * A moment, as a reader reads it.
 *
 * **The first timestamp this product renders anywhere.** Every date on the wire
 * is an ISO-8601 instant in UTC and until session 9 nothing showed one: the
 * dashboard counts records, the review page names revisions by number, and a
 * comment says which revision it belongs to rather than what time it was
 * written. The record page's timeline is a list ordered by time, so it is the
 * first surface that has to say when.
 *
 * **The reader's own locale and zone**, which is what `undefined` as the first
 * argument means. A fix landed at 09:30 for the person who landed it, and a page
 * that printed UTC would be telling him the wrong hour on his own commits.
 *
 * That is also why nothing asserts this string. The formatted text depends on
 * the machine, and a scenario pinned to one rendering of it would be a scenario
 * about the CI box's locale — so the timeline puts the ISO instant on the
 * element's `dateTime` attribute, which is where a `<time>` element is supposed
 * to carry the machine-readable half anyway, and the scenarios read that.
 *
 * The formatter is built once: `Intl.DateTimeFormat` is expensive to construct
 * and a timeline builds one line per event.
 */
const FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/**
 * Falls back to the string it was given rather than printing "Invalid Date". The
 * wire's dates are ISO instants and this cannot happen through the product —
 * which is exactly why the fallback shows what arrived instead of hiding it.
 */
export function whenText(iso: string): string {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? iso : FORMAT.format(at)
}
