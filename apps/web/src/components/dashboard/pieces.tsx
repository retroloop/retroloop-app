import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import type { LifecycleState } from '@/components/records/record-lifecycle'
import { cn } from '@/lib/utils'

/**
 * The two containers and the one figure all three variations are assembled from.
 *
 * They are shared for the same reason the arithmetic is: the round is asking the
 * owner to choose between three *arguments*, and three sets of slightly different
 * card padding would put a fourth variable in the comparison. What each variation
 * chooses is which panels exist, what goes in them, and what order they come in.
 */

/**
 * A titled region of the page — the unit a dashboard is read in.
 *
 * The heading is the `section-label` idiom the review page established: uppercase,
 * letter-spaced, muted. It is small because a dashboard's headings are signposts
 * rather than content — the numbers under them are the content, and a heading in
 * the same weight as its own figures competes with them.
 *
 * `claim` is the one sentence saying what the panel asserts. It is optional and
 * used sparingly: on a chart whose reading is not obvious from its axes, a line
 * of prose is cheaper than a legend the reader has to decode, and on a stat row
 * it would be a caption nobody needs.
 */
export function Panel({
  title,
  claim,
  action,
  children,
  className,
  testId,
}: {
  title: string
  claim?: string
  action?: ReactNode
  children: ReactNode
  className?: string
  testId?: string
}) {
  return (
    <section data-testid={testId} className={cn('flex min-w-0 flex-col gap-3', className)}>
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="section-label">{title}</h3>
          {claim === undefined ? null : <p className="text-muted-foreground text-sm">{claim}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

/** A panel's contents inside a card — the surface a chart needs behind it. */
export function Surface({
  children,
  className,
  testId,
}: {
  children: ReactNode
  className?: string
  testId?: string
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        'min-w-0 overflow-hidden rounded-xl border border-hairline bg-card p-4 sm:p-5',
        className,
      )}
    >
      {children}
    </div>
  )
}

/**
 * **The stat tile**, to the contract: a label, a value, and one supporting line
 * that says what the value means rather than restating it.
 *
 * `shadcn-dashboard-01.png` puts a signed delta chip in the corner of each card
 * and a trend sentence under the number, and the delta is the part this data
 * **cannot honestly fill**. A delta needs a previous period and this store has no
 * period: the corpus's time axis is the sitting, sittings are irregular, and "+12.5%
 * vs last month" over five days of work would be a number invented to fill a
 * shape. So the chip slot is spent on something the data does have — a `note`, a
 * short true clause — and the round asks the owner whether he wants it back as a
 * real delta once there is a period to measure against.
 *
 * The value uses **proportional figures, not tabular**: `tabular-nums` gives every
 * digit the width of a zero, which at display size makes `154` look gappy. Tabular
 * is for columns that must align, which a row of tiles is not.
 *
 * `opens` makes the tile a link, and it takes a **lifecycle position rather than
 * a URL**. Only a tile whose number can be *landed on* gets one — the open count
 * goes to `/records?lifecycle=open`, which is the same filter the number counted,
 * because a figure on a dashboard that cannot be opened is a figure the reader has
 * to go and re-find by hand.
 *
 * The narrower prop is what keeps the destination typed. A `to`/`search` pair on a
 * general-purpose tile has to be cast past the route tree — TanStack Router types
 * the two together, per route — and a cast here would be this component quietly
 * opting out of the one check that stops it linking to a filter `/records` does not
 * police (`r-validatesearch-narrows-not-polices`). There is exactly one destination
 * any tile on this page wants, so the prop names it and the router checks it.
 */
export function StatTile({
  label,
  value,
  note,
  support,
  opens,
  testId,
  tone = 'plain',
  pair,
}: {
  label: string
  /** The single figure. Ignored when `pair` is given. */
  value?: string | number
  /** The corner clause — where dashboard-01 puts its delta chip. */
  note?: string
  /** The line under the number: what it means, not what it is. */
  support?: string
  /** The lifecycle cut of `/records` this tile's number lands on, if any. */
  opens?: LifecycleState
  testId?: string
  /** `lead` gives the one tile the page is about a heavier value. */
  tone?: 'plain' | 'lead'
  /**
   * Two or more labelled counts **instead of** one figure, for a tile whose
   * reading is a split rather than a total (the Human-in-the-Loop box, D7).
   *
   * They are rendered side by side at a smaller size than a lone `value`, because
   * the comparison between them is the point and two display-size numbers in one
   * card compete instead of pairing. A zero is drawn like any other count here —
   * the owner asked for it, and on a pair the absent half is the louder half of
   * the sentence.
   */
  pair?: readonly { readonly label: string; readonly value: number }[]
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="text-muted-foreground text-sm">{label}</span>
        {note === undefined ? null : (
          <span className="shrink-0 rounded-md border border-hairline px-1.5 py-0.5 text-[0.6875rem] text-muted-foreground">
            {note}
          </span>
        )}
      </div>
      {pair === undefined ? (
        <span
          data-testid={testId === undefined ? undefined : `${testId}-value`}
          className={cn('font-semibold tracking-tight', tone === 'lead' ? 'text-4xl' : 'text-3xl')}
        >
          {value}
        </span>
      ) : (
        <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
          {pair.map((entry) => (
            /**
             * **Term first in the document, number first on the screen.**
             *
             * A definition list means `<dt>` then `<dd>`, and this rendered them
             * the other way round — flagged in session 11 as pre-existing,
             * non-conforming, and *load-bearing*, because the reading the tile
             * is for is the figure with its name under it. Both are true at
             * once: the DOM says what the markup means and `flex-col-reverse`
             * says what it looks like, which is the half a stylesheet is
             * allowed to decide.
             *
             * The two entries are identical in structure, so the `items-baseline`
             * on the list above still aligns them with each other — what the
             * reversal moves, it moves for both.
             */
            <div key={entry.label} className="flex flex-col-reverse">
              <dt className="text-muted-foreground text-xs">{entry.label}</dt>
              <dd
                data-testid={testId === undefined ? undefined : `${testId}-${slug(entry.label)}`}
                className="font-semibold text-2xl leading-none tracking-tight"
              >
                {entry.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {support === undefined ? null : (
        <span className="text-muted-foreground text-xs leading-snug">{support}</span>
      )}
    </>
  )

  const shell = cn(
    'flex min-w-0 flex-col gap-1.5 rounded-xl border border-hairline bg-card p-4',
    opens !== undefined && 'transition-colors hover:border-primary/40 hover:bg-surface-raised',
  )

  if (opens === undefined) {
    return (
      <div data-testid={testId} className={shell}>
        {body}
      </div>
    )
  }

  return (
    <Link to="/records" search={{ lifecycle: opens }} data-testid={testId} className={shell}>
      {body}
    </Link>
  )
}

/** The row a set of tiles sits in — one column each, wrapping down at narrow widths. */
export function StatRow({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div
      data-testid={testId}
      className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
    >
      {children}
    </div>
  )
}

/**
 * **The hero figure** — the one number a view leads with, and exactly one per
 * view.
 *
 * It is >= 48px and in the same sans as the rest of the page: a display face here
 * would read as decoration, which is the one thing a number this size must not.
 */
export function Hero({
  value,
  label,
  children,
  testId,
}: {
  value: string | number
  label: string
  /** What qualifies the number — a meter, a key, a link. */
  children?: ReactNode
  testId?: string
}) {
  return (
    <div data-testid={testId} className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-semibold text-5xl leading-none tracking-tight">{value}</span>
        <span className="text-muted-foreground">{label}</span>
      </div>
      {children}
    </div>
  )
}

/** A pair entry's label, as a testid suffix. */
function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
