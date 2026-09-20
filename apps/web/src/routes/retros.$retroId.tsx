import type { AppRouterOutputs } from '@retro/api'
import { useIsFetching, useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { AppShell } from '@/components/chrome/app-shell'
import { NotFoundPage, PlaceholderPage } from '@/components/chrome/placeholder-page'
import { RetroStateTag } from '@/components/retro-state'
import { RecordCard } from '@/components/review/record-card'
import {
  EmptiedFilter,
  type RecordFilter,
  RecordFilterBar,
  RecordSlot,
  useRecordFilter,
} from '@/components/review/record-filter'
import { RecordIndexAffordance, RecordRail } from '@/components/review/record-rail'
import { ReviewActions } from '@/components/review/review-actions'
import {
  ReviewCommentRail,
  ReviewCommentsAffordance,
  useReviewComments,
} from '@/components/review/review-thread'
import { RevisionBanner } from '@/components/review/revision-banner'
import { APP_NAME } from '@/lib/app-name'
import { integerId } from '@/lib/ids'
import { useLiveSession } from '@/lib/live'
import { retroIdentityLine, retroName } from '@/lib/retro-identity'
import { reviewCrumbs } from '@/lib/review-crumbs'
import { useSidePanel } from '@/lib/side-panel'
import { useTRPC } from '@/lib/trpc'

/**
 * A stable empty list for the header affordance, which is rendered in the same
 * pass as the loading shell: a fresh `[]` every render would give the panel a
 * new `records` identity on every keystroke in the composer.
 */
const NO_RECORDS: AppRouterOutputs['records']['list']['records'] = []

type ReviewSearch = {
  /** `?rev=k` pins an older revision, read-only. */
  readonly rev?: number
  /**
   * `?record=<rid>` — the record a link is pointing at.
   *
   * With `&view=history` it is one record across revisions, Tier 2, and
   * still a stub. On its own it is the **anchor** a link into this page
   * carries, so arriving here arrives *at the record* rather than at the top of
   * a review that may hold a dozen of them.
   *
   * **Who sends it changed, and so did the rule behind it.** It was the flat
   * records page's rows — no per-record detail page, this page is a record's
   * detail view and there is no other one. That reversed on first contact:
   * clicking a record on the records page used to take the reader to the retro
   * page, but each record now has its own dedicated page. So a row goes to
   * `/records/:globalId` now, and the sender of this anchor is that page's own
   * link back to the review — the way to go to the retro page it asked for. The
   * mechanism is unchanged; what is upstream of it is not.
   */
  readonly record?: string
  readonly view?: 'history'
}

/**
 * **`validateSearch` narrows the type; it does not police the value.**
 *
 * The comments this route carried used to read as though what this function
 * leaves out never reaches the page. It does: measured on two independently
 * written surfaces, the validator runs — three times — returns the key-less
 * object below, and `Route.useSearch()` hands back the raw search anyway. So
 * what this is, is the *type* the rest of the file is written against; every
 * value it describes is checked again at the point where it is used, by the
 * three guards under it, which is the only place a value cannot arrive by
 * another route.
 *
 * `?rev=abc` was the live one. `Number('abc')` is `NaN`, the key is omitted here,
 * and the page still read `'abc'` — pinning the review to a revision that does
 * not exist, which asks the store for records under a string, renders none, and
 * marks the round read-only because `'abc' < 3` is false but `revision < latest`
 * was never asked of a string. A hand-edited address should land somewhere
 * sensible; this one landed on an empty, uneditable review.
 */
export const Route = createFileRoute('/retros/$retroId')({
  validateSearch: (search: Record<string, unknown>): ReviewSearch => {
    const rev = Number(search.rev)
    return {
      ...(Number.isInteger(rev) && rev > 0 ? { rev } : {}),
      ...(typeof search.record === 'string' ? { record: search.record } : {}),
      ...(search.view === 'history' ? { view: 'history' as const } : {}),
    }
  },
  component: ReviewPage,
})

/**
 * The revision the address pinned, if it pinned one at all: a whole number above
 * zero, and nothing else — the same test the validator states, made again where
 * the answer is used. Anything else is not a pin, and a review with no pin opens
 * on the newest revision, which is where a reader who typed the URL by hand
 * meant to be.
 */
function pinnedRevision(rev: unknown): number | undefined {
  const revision = Number(rev)
  return Number.isInteger(revision) && revision > 0 ? revision : undefined
}

/**
 * The record the address named, if it named one. A `?record=` that is not a
 * string — `?record[]=x` parses as an array — is not an anchor, and handing one
 * to the landing effect or to the history stub's title would be handing a
 * non-string to something that expects a record id.
 *
 * A string naming a record this revision does not hold needs no guard: the
 * landing effect looks it up and finds nothing, which is the same as arriving
 * with no anchor at all.
 */
function anchoredRecord(record: unknown): string | undefined {
  return typeof record === 'string' ? record : undefined
}

function ReviewPage() {
  const { retroId: rawId } = Route.useParams()
  const id = integerId(rawId)
  if (id === undefined) return <NotFoundPage what="retrospective" id={rawId} />
  return <Review retroId={id} />
}

function Review({ retroId }: { retroId: number }) {
  /**
   * Read once and policed once, here rather than at each of the four places
   * these three are used: the type says what they are and the guards say what
   * they turned out to be (§validateSearch above).
   */
  const search = Route.useSearch()
  const rev = pinnedRevision(search.rev)
  const record = anchoredRecord(search.record)
  const view = search.view === 'history' ? ('history' as const) : undefined
  const trpc = useTRPC()
  const navigate = useNavigate({ from: Route.fullPath })
  const live = useLiveSession(retroId)

  const retro = useQuery(trpc.retros.get.queryOptions({ retroId }))

  // The revision on screen: what the URL pinned, or the newest one that exists.
  const shown = rev ?? retro.data?.latestRevision ?? undefined
  const list = useQuery({
    ...trpc.records.list.queryOptions({
      retroId,
      ...(shown === undefined ? {} : { revision: shown }),
    }),
    enabled: retro.data !== undefined,
  })
  const filter = useRecordFilter(list.data?.records)
  /**
   * The record index's rail-or-sheet, held here for the same reason the
   * comments' is: its two mounts are in two parts of the tree — the rail beside
   * the reading column, the glyph that opens its sheet in the sticky header.
   */
  const index = useSidePanel()
  /**
   * The review's own comments, held here because their two mounts are in two
   * parts of the tree: the rail below, beside the reading column, and the
   * affordance in the sticky header (`review-thread.tsx`).
   */
  const comments = useReviewComments(retroId)
  /**
   * `?record=<rid>` on its own is the anchor a link into this review carries —
   * the record page's link back to it. With `view=history` it means the Tier 2
   * stub below instead, which is a page of its own and has nothing to scroll
   * to.
   */
  useAnchorLanding(view === 'history' ? undefined : record, filter)

  if (retro.isError) return <NotFoundPage what="retrospective" id={String(retroId)} />
  if (retro.data === undefined) return <AppShell crumbs={[{ label: APP_NAME, to: '/' }]} />

  /**
   * `latestRevision` is nullable on the wire but never null in real data:
   * `createRevision` starts the retrospective and writes revision 1 in the same
   * unit of work, and nothing else can start one — so a revision-less
   * retrospective is unreachable through the product, and only a hand-built mock
   * could produce the empty page this fallback would render. Do not "fix" that
   * page: there is nothing to fix, and a scenario for it would be a scenario
   * about the mock.
   */
  const latest = retro.data.latestRevision ?? 1
  const revision = list.data?.revision ?? shown ?? latest
  const finished = retro.data.state === 'finished'
  /**
   * Whether the human has already finished the round on screen, off the store
   * rather than out of this session's memory (`r-finish-button-reenables`).
   *
   * Per revision, which is the whole point: the retro's own `finishedAt` is the
   * AI's close and stays null through every round but the last, so it could
   * never have answered "has the human finished the one being looked at?".
   */
  const roundFinished = retro.data.revisions.find((meta) => meta.n === revision)?.finishedAt != null
  /**
   * Read-only in two cases, for the same reason: what is on screen is not what a
   * decision could be made against. An older revision is history, and a finished
   * review is terminal.
   */
  const readOnly = finished || revision < latest

  const crumbs = reviewCrumbs(retro.data, revision)

  if (view === 'history') {
    return (
      <PlaceholderPage
        crumbs={crumbs}
        kind="Record history"
        title={record ?? 'Record history'}
        placeholder="One record across every revision, with the changed sections marked — Tier 2."
      />
    )
  }

  return (
    <AppShell
      crumbs={crumbs}
      /**
       * The record index's narrow mount, on the left of the header because its
       * sheet opens from the left (`record-rail.tsx`). It is rendered only once
       * the revision's records are known: an index of nothing is nothing, and
       * the loading pass has nothing to index.
       */
      lead={
        list.data === undefined ? null : (
          <RecordIndexAffordance records={list.data.records} filter={filter} index={index} />
        )
      }
      action={
        <ReviewCommentsAffordance
          retroId={retroId}
          revision={revision}
          readOnly={readOnly}
          comments={comments}
          records={list.data?.records ?? NO_RECORDS}
          jumpTo={filter.jumpTo}
        />
      }
    >
      <div className="flex flex-col gap-5">
        {/**
         * What this retrospective is called, what state it is in, and where it
         * happened — the same name, the same tag and the same identity line the
         * dashboard row carried, so the click-through lands somewhere the
         * reader recognises. The name is the *latest* revision's, which is why
         * it can change under a reviewer: it changes when they take the
         * announced revision, not when the AI files it.
         *
         * The state tag is what says so: until it existed a finished
         * retrospective never said it was finished anywhere near the top of the
         * page. It is also all the tag adds — no revision line, no counts, no
         * timestamps. The pending count in particular stays where it already
         * is: the pending chip on the decision bar carries it live, and it is
         * the only place that does since an earlier redesign took the review's
         * box away — a second copy in the header would be a number to keep in
         * agreement.
         */}
        <header className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-semibold text-lg tracking-tight" data-testid="retro-name">
              {retroName(retro.data)}
            </h1>
            <RetroStateTag state={retro.data.state} />
          </div>
          <p className="meta-mono break-words" data-testid="retro-identity">
            {retroIdentityLine(retro.data)}
          </p>
        </header>

        {live.availableRevision !== null && live.availableRevision > revision ? (
          <RevisionBanner
            revision={live.availableRevision}
            onLoad={() => {
              const target = live.availableRevision
              live.acknowledge()
              if (target !== null) void navigate({ search: { rev: target } })
            }}
          />
        ) : null}

        {list.data === undefined ? null : (
          <div className="flex gap-8">
            <RecordRail records={list.data.records} filter={filter} index={index} />

            {/* `min-w-0` so a long word inside a record narrows the column
                rather than widening the page (nothing scrolls sideways).

                `wide:max-w-[48rem]` is what makes one page measure possible. The
                extra room the page takes at `wide` was bought for a third
                column, and `flex-1` with nothing to stop it hands that room to
                the prose the moment the comment rail is not there — 992px of
                line length on every retrospective filed before review-level
                comments, which is every closed review a reviewer revisits.
                Capped, the column runs from 704px at the breakpoint itself to
                768px once the page has stopped widening; the room a rail is not
                using stays empty, and the column does not move when a rail
                arrives.

                768 rather than the 736 it was: an earlier change widened both
                rails, and
                the page's own measure grew by more than the two of them together
                so the prose gained rather than paid for them.

                A later change widened the rails again and this cap did **not**
                move, which is the whole of the wider-breakpoint tradeoff: all
                of the extra width goes to the left index panel and the right
                comments panel.
                The measure grew by exactly what the two rails took, so the band
                the column runs in is the same 704–768 it was; what changed is
                the width at which it enters that band. The reading column's
                measure is a typography ceiling, and the one direction it was
                never going to be tuned is wider.

                At the widths below `wide` there is no third column to reserve
                and nothing to cap: the reading column is the page, as it was. */}
            <div className="flex min-w-0 flex-1 flex-col gap-5 wide:max-w-[48rem]">
              {/**
               * The bar's design: the filter on the left, the review's one act
               * on the right, stuck under the header rather than scrolling away
               * with the first record. The act was a bordered box at the end of
               * this column until an earlier redesign removed it in favor of a
               * button next to the filters — so it is passed in here rather
               * than rendered below, and the filter's own landing target moved
               * with it.
               */}
              <RecordFilterBar
                filter={filter}
                action={
                  <ReviewActions
                    ref={filter.actionsRef}
                    retroId={retroId}
                    list={list.data}
                    finished={finished}
                    roundFinished={roundFinished}
                    readOnly={readOnly}
                  />
                }
              />

              <EmptiedFilter filter={filter} />

              {filter.shown.map((summary) => (
                <RecordSlot key={summary.rid} filter={filter} rid={summary.rid}>
                  <RecordCard
                    retroId={retroId}
                    revision={list.data.revision}
                    summary={summary}
                    readOnly={readOnly}
                    onComment={(rid, section) => comments.commentOn({ rid, section })}
                  />
                </RecordSlot>
              ))}
            </div>

            {/**
             * The review's own surface — the round as a whole rather than any
             * one record in it, and **one surface and not two**: comments at
             * the review level cover the same need, with one individual request
             * addressable per comment.
             *
             * It shipped as a full-width panel here, above the first record,
             * and a later fix took it out of the reading column: a composer at
             * the top of the page costs a scroll up and a scroll back for every
             * mid-list ask, and costs the fold whether it is used or not.
             * Beside the column it costs neither.
             *
             * It takes the page's one `readOnly`. The half that matters is
             * `finished`, which is the domain's own terminal state — the server
             * refuses a comment on a finished retrospective. The other half, an
             * older revision pinned, is the page being consistent with itself:
             * the server would accept a comment from there, but a page that is
             * history everywhere else should not be the one place still
             * offering to write.
             *
             * An earlier redesign made it the *only* comments surface: it lists
             * every thread of the retrospective, record-level included,
             * replacing inline comments in the retro body with comments in the
             * side panel — so a human can see all comments in one place. It
             * takes the revision's records so a record thread can say which
             * record it hangs on, and the filter's `jumpTo` so saying it is one
             * click from getting there — the same landing an index entry uses,
             * because two landings would be two places a reviewer could end up.
             */}
            <ReviewCommentRail
              retroId={retroId}
              revision={list.data.revision}
              readOnly={readOnly}
              comments={comments}
              records={list.data.records}
              jumpTo={filter.jumpTo}
            />
          </div>
        )}
      </div>
    </AppShell>
  )
}

/**
 * Put the reader down on the record a link named, once the page has stopped
 * growing under them.
 *
 * A record's own page links here (`routes/records_.$recordId.tsx`), and arriving
 * at the top of a review that holds a dozen records is not arriving at the
 * record they came from. Nothing else on this page reads `?record=` — the index
 * rail and the comments panel both jump within a page the reader is already on —
 * so this is the whole of the anchor.
 *
 * **The timing is the hard half, and it is read off the query cache rather than
 * off a clock.** A card renders its heading from the list and fetches its own
 * narrative, so the column keeps growing for as long as those are in flight: a
 * scroll taken the moment the list answers puts the record where it *was* going
 * to be and everything above it then shoves it down the page. `useIsFetching`
 * over the record queries is what makes those arrivals visible from here at all,
 * because a card's body landing does not otherwise re-render this component —
 * and every time the count reaches zero, this asks again for the position that
 * is true now. Two or three instant scrolls to converging positions, and no
 * waiting on a number somebody guessed.
 *
 * **The reader takes it back the moment they move.** A wheel, a key, a touch or
 * a press releases the landing for good, because a page that pulled them back to
 * an anchor they had scrolled away from would be a page arguing with them — and
 * the thirty-second background refetch would otherwise be entitled to do exactly
 * that.
 */
function useAnchorLanding(rid: string | undefined, filter: RecordFilter): void {
  const trpc = useTRPC()
  const fetching = useIsFetching({ queryKey: trpc.records.pathKey() })
  const taken = useRef(false)
  const { jumpTo } = filter

  useEffect(() => {
    if (rid === undefined) return
    const release = () => {
      taken.current = true
    }
    const acts = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const
    for (const act of acts) window.addEventListener(act, release, { passive: true })
    return () => {
      for (const act of acts) window.removeEventListener(act, release)
    }
  }, [rid])

  useEffect(() => {
    if (rid === undefined || fetching > 0 || taken.current) return
    jumpTo(rid, 'instant')
  }, [rid, fetching, jumpTo])
}
