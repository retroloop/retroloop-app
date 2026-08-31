import type { AppRouterOutputs } from '@retro/api'
import { ListIcon } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { DECISION_TAG } from '@/components/review/decision-state'
import type { RecordFilter } from '@/components/review/record-filter'
import { Button } from '@/components/ui/button'
import type { SidePanel } from '@/lib/side-panel'
import { cn } from '@/lib/utils'

type RecordSummary = AppRouterOutputs['records']['list']['records'][number]

/**
 * The index (shortlist G2, ledger v2 C21 / v1 #1). A review is one long scroll,
 * and without this the reviewer has no idea how much of it is left, which
 * records they have already dealt with, or how to get back to one.
 *
 * It is an *index*, so it lists every record of the revision on screen — always
 * all of them, whatever the filter is doing. An index that hides entries is a
 * second filter wearing an index's clothes: the reviewer would have to trust
 * that nothing is missing, and the one thing an index is for is being able to
 * see that nothing is. Entries the filter has taken off the page dim instead,
 * and lead nowhere, because there is nowhere to lead to.
 *
 * Nothing else is in here. No heading, no counts, no controls: the chips already
 * carry the counts and the filter, and an index that grew a second copy of them
 * would be two places to read the same number from.
 *
 * **It has two mounts since session 7.** It shipped as a rail that simply left
 * below `xl` — *"on the portrait iPad the reading column is the whole screen and
 * the rail steps out of the way — no drawer, no button to open it, because a
 * two-tap index on a page you can scroll is not worth the tap or the code"* —
 * and the owner reviewed on that screen and said otherwise: *"On iPad, I don't
 * see the issues list that enable me to jump to specific issues by clicking on
 * them. On iPad they should open in a left panel just like comments open from
 * the right panel."* So below `xl` it is one glyph in the header and a sheet
 * that opens from the left, the comments' own shape mirrored.
 *
 * Exactly one mount exists at a time (`lib/side-panel.ts`), and the two share
 * this file's `RecordIndex` — one list, so the two indexes of the same records
 * cannot come to say different things.
 */
export function RecordRail({
  records,
  filter,
  index,
}: {
  records: readonly RecordSummary[]
  filter: RecordFilter
  index: SidePanel
}) {
  if (!index.fits) return null

  return (
    // `self-start` + `sticky` rather than a full-height column: the rail follows
    // the reader down a long review instead of scrolling away with the first
    // record, and caps at the viewport so a fifty-record retro scrolls the rail
    // rather than the page.
    //
    // `w-72` — 288px, up from 240 in session 10 (`r-wider-page-for-panels`:
    // *"all of it should go to the left index panel and the right comments
    // panel"*), and 208 before that. Still the narrower of the two, and by more
    // than it was: an entry is a number and a title that truncates, where a
    // thread is a conversation that wraps, so of the 128px the page gained this
    // column took 48 and the comments took 80.
    <nav
      aria-label={INDEX_LABEL}
      data-testid="record-rail"
      className="sticky top-20 max-h-[calc(100dvh-6rem)] w-72 shrink-0 self-start overflow-y-auto"
    >
      <RecordIndex records={records} filter={filter} jumpTo={filter.jumpTo} />
    </nav>
  )
}

/**
 * The narrow answer, and it is the comments' answer reflected: one glyph in the
 * header that is already there, so the index costs the page no vertical space at
 * all, and a sheet that opens *over* the reading column rather than in it.
 *
 * It opens from the **left** because that is where the rail is on the screens
 * that have one, and because the comments open from the right — two sheets that
 * came from the same edge would be two things a reviewer has to tell apart after
 * they have arrived. No count on it: the chips beside it carry every number this
 * page has, and a second copy would be one to keep in agreement.
 */
export function RecordIndexAffordance({
  records,
  filter,
  index,
}: {
  records: readonly RecordSummary[]
  filter: RecordFilter
  index: SidePanel
}) {
  // At `wide` the rail is on screen, so a second way in would be a second copy
  // of the same list in the same document.
  if (index.fits) return null

  return (
    <Dialog.Root open={index.open} onOpenChange={index.setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="ghost" size="sm" data-testid="record-index" aria-label={INDEX_LABEL}>
          <ListIcon aria-hidden />
        </Button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay
          data-testid="record-index-backdrop"
          className="fixed inset-0 z-40 bg-background/70"
        />
        {/* `aria-describedby={undefined}`: the sheet is the list and nothing
            else, and there is nothing to describe that it does not say itself.

            The same reveal rule the comments sheet takes — `min(cap, 100vw -
            4rem)`, a fixed 64px of page left uncovered rather than a proportion
            of it — with its own cap, because the two sheets are the two rails
            and an index entry is still a number and a truncated title rather
            than a conversation. 26rem where the comments take 48rem.

            On a phone neither cap binds and the two sheets are the same width:
            below 480px there is one width worth having and it is all of it bar
            the strip. */}
        <Dialog.Content
          aria-describedby={undefined}
          data-testid="record-index-sheet"
          className="fixed inset-y-0 left-0 z-50 flex w-[min(26rem,calc(100vw-4rem))] flex-col border-hairline border-r bg-card px-4 py-4 shadow-xl"
        >
          <Dialog.Title className="sr-only">{INDEX_LABEL}</Dialog.Title>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
            {/* A jump closes the sheet first: the record it lands on is under
                the backdrop, so scrolling to it without closing would put the
                reviewer somewhere they cannot see. The comments sheet's own
                jump does the same, for the same reason. */}
            <RecordIndex
              records={records}
              filter={filter}
              jumpTo={(rid) => {
                index.setOpen(false)
                filter.jumpTo(rid)
              }}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** What both mounts are, said once — the rail's label and the sheet's title. */
const INDEX_LABEL = 'Records in this revision'

/**
 * The list itself, shared by the rail and the sheet. `jumpTo` is passed in
 * rather than read off the filter, because the sheet has one more thing to do
 * on the way to a record than the rail does.
 */
function RecordIndex({
  records,
  filter,
  jumpTo,
}: {
  records: readonly RecordSummary[]
  filter: RecordFilter
  jumpTo: (rid: string) => void
}) {
  const onPage = new Set(filter.shown.map((record) => record.rid))

  return (
    <ol className="flex flex-col gap-0.5">
      {records.map((record) => {
        // A record on its way out of the filter is not a place to go: for the
        // fifth of a second it is still in the document, it is already a
        // record the reviewer has finished with.
        const reachable = onPage.has(record.rid) && !filter.departing.has(record.rid)
        const { ink, label, icon: Icon } = DECISION_TAG[record.state]

        return (
          <li key={record.rid}>
            <button
              type="button"
              data-testid={`rail-entry-${record.rid}`}
              // Both, and they say different things: `disabled` takes the
              // entry out of the tab order so keyboard users are not walked
              // through entries that go nowhere, and `aria-disabled` is what
              // a screen reader announces when they land on the list.
              disabled={!reachable}
              aria-disabled={!reachable}
              onClick={() => jumpTo(record.rid)}
              className={cn(
                'flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left transition-colors',
                reachable ? 'hover:bg-accent' : 'opacity-40',
              )}
            >
              {/* The state, as a mark small enough to sit in a list: its own
                  icon *shape* and its own ink, never the ink alone — and the
                  word itself for anyone being read to. */}
              <Icon aria-hidden className={cn('size-3 shrink-0 translate-y-0.5', ink)} />
              <span className="sr-only" data-testid="rail-state">
                {label}
              </span>
              {/* The record's number in the whole ledger, which is the number it
                  carries on every other surface too — the rail is an index, and
                  an index that used a different name for a record than the page
                  it indexes would be worse than no index. */}
              <span className="meta-mono shrink-0 tabular-nums" data-testid="rail-num">
                #{record.globalId}
              </span>
              {/* Truncated, not wrapped: the index is for finding a record, and
                  the whole record is one click away. */}
              <span className="min-w-0 truncate text-xs leading-relaxed" data-testid="rail-title">
                {record.title}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
