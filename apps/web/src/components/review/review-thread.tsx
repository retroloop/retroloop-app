import type { AppRouterOutputs } from '@retro/api'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquareIcon, XIcon } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { useCallback, useState } from 'react'
import {
  ComposerBox,
  type Invalidate,
  type Thread,
  type ThreadAnchor,
  ThreadCard,
} from '@/components/review/comment-threads'
import { Button } from '@/components/ui/button'
import { type RecordSection, SECTION_TITLES } from '@/lib/enum-labels'
import { type SidePanel, useSidePanel } from '@/lib/side-panel'
import { useTRPC } from '@/lib/trpc'

type RecordSummary = AppRouterOutputs['records']['list']['records'][number]

/**
 * The comments panel: **the one place comments are read and written**, and the
 * two mounts it takes depending on how much room the page has.
 *
 * It began as the review's own threads, anchored to no record at all — the
 * answer to `r-review-actions-pinned`: going record by record and wanting to
 * comment meant scrolling all the way up to the composer and then finding the
 * way back. Nine round trips in one round, plus 120–240px of the fold spent on
 * a panel nobody was reading: pinning it to the top consumes a lot of vertical
 * space on a tablet. So the comments left the reading column: a rail beside it
 * where there is room for a third column, one glyph in the chrome where there
 * is not.
 *
 * It then took the rest of the comments. Record threads used to render inside
 * the section they answered, which meant a reviewer had to walk the whole page
 * to find out what had been said, so inline comments in the retrospective body
 * were replaced by comments in the side panel and the human sees all of them in
 * one place. So `threads.list` returns every thread, the record body renders
 * none of them, and a record thread carries a line saying which record and
 * which section it hangs on, one click from getting there.
 *
 * Neither mount has a heading. The rail is beside the records and the sheet has
 * a composer in it that says what it takes — a line reading "Comments" over
 * either would be restating the obvious in space the reading column used to pay
 * for.
 */

/** Where the next comment goes when the reviewer aimed it at a record's section. */
export type CommentAnchor = {
  readonly rid: string
  readonly section: RecordSection
}

export type ReviewComments = SidePanel & {
  readonly threads: readonly Thread[]
  /** What the composer is aimed at, or `null` for a comment about the review. */
  readonly anchor: CommentAnchor | null
  /**
   * How many times the reviewer has aimed it. A counter rather than a flag,
   * because aiming at a second section after changing their mind is a second
   * act and has to move the keyboard again (`ComposerBox`).
   */
  readonly aim: number
  /** A record's "Comment" button, pressed. */
  readonly commentOn: (anchor: CommentAnchor) => void
  readonly clearAnchor: () => void
}

/**
 * One query, one open/closed flag and one anchor, held by the page rather than
 * by either mount — because the two mounts are in different parts of the tree.
 * The rail belongs beside the reading column and the sheet's affordance belongs
 * in the sticky header, and a count in the header that disagreed with the
 * threads in the sheet would be exactly the silent failure the badge exists to
 * prevent.
 *
 * The anchor is up here for the same reason and one more: it is set from a
 * record card, three levels down the *other* branch of the tree.
 */
export function useReviewComments(retroId: number): ReviewComments {
  const trpc = useTRPC()
  const [anchor, setAnchor] = useState<CommentAnchor | null>(null)
  const [aim, setAim] = useState(0)
  const threads = useQuery(trpc.threads.list.queryOptions({ retroId }))
  /** The rail-or-sheet half, shared with the record index (`lib/side-panel.ts`). */
  const { fits, open, setOpen } = useSidePanel()

  /**
   * Pressing Comment on a section does not open a composer *there* any more — it
   * aims the one composer the page has. Where there is a rail the panel is
   * already on screen and only the keyboard has to move; where there is not, the
   * sheet has to come out first, because a chip in a panel nobody can see is a
   * click that did nothing.
   */
  const commentOn = useCallback(
    (next: CommentAnchor) => {
      setAnchor(next)
      setAim((aimed) => aimed + 1)
      if (!fits) setOpen(true)
    },
    // `setOpen` is a `useState` setter and never changes identity, but it
    // arrives through `useSidePanel` and the linter cannot see that far.
    [fits, setOpen],
  )

  const clearAnchor = useCallback(() => setAnchor(null), [])

  return {
    fits,
    // `undefined` counts as none rather than painting chrome while the query is
    // in flight and then taking it away again.
    threads: threads.data ?? [],
    open,
    setOpen,
    anchor,
    aim,
    commentOn,
    clearAnchor,
  }
}

/**
 * Nothing to read, and on a read-only review nothing either mount could ever
 * offer — so a rail would be an empty column and the affordance a glyph that
 * opens onto nothing. That is not an edge case: **every retrospective filed
 * before review-level comments has no review thread**, so it is the state of
 * every closed review a reader revisits.
 *
 * It reads *every* thread, which is the honest question now that the panel is
 * the one comments surface: a closed review with a comment on one of its
 * records has something to show, and used to be told it had nothing.
 *
 * Only when read-only. On a live review the composer *is* the affordance — being
 * able to type from wherever the reviewer is standing is the whole point — so an
 * empty one still shows.
 */
function silent(comments: ReviewComments, readOnly: boolean): boolean {
  return readOnly && comments.threads.length === 0
}

/**
 * Whether the comment rail is on the page: there is room for a third column and
 * there is something for it to hold.
 *
 * **This used to decide the page's width as well**, and the coupling is gone.
 * The page was widened to 80rem unconditionally once while the rail hid itself
 * on a read-only review with no thread of its own, and the reading column —
 * `flex-1` with no cap — took the empty column's room: 992px of prose against
 * the 736px it had before any of this. The fix at the time was to widen the
 * page only while the rail was there, which made the page's measure a function
 * of a query's answer and left the dashboard narrower than the review, so the
 * width of the home page and the width of the retrospective page no longer
 * agreed. The cap now lives on the reading column itself
 * (`retros.$retroId.tsx`), so this predicate is the rail's own business again.
 */
function commentRailMounts(comments: ReviewComments, readOnly: boolean): boolean {
  return comments.fits && !silent(comments, readOnly)
}

/** What both mounts need beyond the threads themselves. */
type PanelProps = {
  retroId: number
  /** The revision on screen — stamped onto whatever is written from here. */
  revision: number
  readOnly: boolean
  comments: ReviewComments
  /** The shown revision's records, for a record thread's `#n · title` line. */
  records: readonly RecordSummary[]
  jumpTo: (rid: string) => void
}

/**
 * The wide-screen home: a third column beside the reading one, in the record
 * rail's idiom — sticky, capped at the viewport, scrolling itself rather than
 * the page. The reading column never reflows when a comment is written here,
 * because nothing that happens in this column is in that one's flow.
 *
 * `w-92` — 368px, up from 288 and 240 before that: the page was widened to give
 * the comments and the side rail more room, and all of the gain went to the left
 * index panel and the right comments panel (`r-wider-page-for-panels`). It is
 * the wider of the two rails because a thread is a conversation and an index
 * entry is a line, and it is why the split of the page's new 128px was weighted
 * here: 80 of them, against the index's 48.
 */
export function ReviewCommentRail(props: PanelProps) {
  if (!commentRailMounts(props.comments, props.readOnly)) return null

  return (
    <aside
      aria-label="Comments on this review"
      data-testid="review-comment-rail"
      className="sticky top-20 flex max-h-[calc(100dvh-6rem)] w-92 shrink-0 self-start"
    >
      <ReviewComments {...props} aimedAt={props.comments.aim} />
    </aside>
  )
}

/**
 * The narrow answer: one glyph in the header that is already there, so the
 * comments cost the page no vertical space at all, and a sheet that opens *over*
 * the reading column rather than in it — the reviewer's place is kept by
 * construction, because nothing under the sheet moves.
 *
 * The count is load-bearing rather than decorative. With the threads out of
 * sight until they are opened, an unanswered comment would otherwise be silent,
 * which is the failure the review page is least able to afford.
 *
 * **It counts the threads still unresolved** (`r-badge-counts-settled`). What the
 * glyph is for is telling the reviewer there is something still to look at, and a
 * number that only ever goes up says nothing about that: once a retrospective has
 * accumulated history a badge stuck at 12 is an archive size rather than a
 * to-do. Counting what is unsettled makes it a number that can reach zero, and
 * reaching zero is exactly the moment the affordance has stopped needing the
 * reviewer.
 *
 * Nothing is hidden by that — the resolved threads are one tap away in the sheet,
 * which shows every thread the retrospective has. Only the summary changed.
 *
 * `silent` is deliberately *not* asked the same question. Whether the panel
 * mounts at all is about whether there is anything to read, and a closed review
 * whose threads are all settled still has its history to show.
 */
export function ReviewCommentsAffordance(props: PanelProps) {
  const { comments, readOnly, jumpTo } = props

  // At `wide` the rail is on screen, so a second way in would be a second place
  // to read the same threads from.
  if (comments.fits) return null
  if (silent(comments, readOnly)) return null

  const count = comments.threads.filter((thread) => !thread.resolved).length

  return (
    <Dialog.Root open={comments.open} onOpenChange={comments.setOpen}>
      <Dialog.Trigger asChild>
        <Button
          variant="ghost"
          size="sm"
          data-testid="review-comments"
          // The badge *is* the name for a reader who cannot see it, so the name
          // says which number this is. "2 comments" on a review holding five
          // would be the label lying about the three that are settled.
          aria-label={unresolvedLabel(count)}
        >
          <MessageSquareIcon aria-hidden />
          {count === 0 ? null : (
            <span className="tabular-nums" data-testid="review-comments-count">
              {count}
            </span>
          )}
        </Button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay
          data-testid="review-comments-backdrop"
          className="fixed inset-0 z-40 bg-background/70"
        />
        {/* `aria-describedby={undefined}`: the sheet is a composer and the
            threads already in it, and there is nothing to describe that the
            content does not say itself.

            The reveal rule, in one expression: `min(cap, 100vw - 4rem)`. The
            sheet takes the width it wants and stops 64px short of covering the
            page, whichever of those two comes first.

            The strip is **fixed** rather than the proportional 85vw it
            replaces: a flyout leaves a constant number of pixels uncovered and
            covers the rest. A proportion gives the phone a 59px strip it cannot
            spare and the iPad a 125px one it does not need; a constant gives
            both the same margin to tap back through, and hands every pixel it
            saves on the wider screen to the comments.

            48rem — 768px, up from 26rem, because on a tablet the flyouts need
            to be wider to take more space. On a 390px phone the cap never binds
            and the sheet is 326px, which is the 332 it was: on a phone the
            earlier width was already enough. */}
        <Dialog.Content
          aria-describedby={undefined}
          data-testid="review-comments-sheet"
          className="fixed inset-y-0 right-0 z-50 flex w-[min(48rem,calc(100vw-4rem))] border-hairline border-l bg-card px-4 py-4 shadow-xl"
        >
          <Dialog.Title className="sr-only">Comments on this review</Dialog.Title>
          {/* `aimedAt={0}`: the sheet does not chase the keyboard. Radix moves
              focus into the content when it opens, and a second mover racing it
              would be two things deciding where the cursor went — the rail has
              no such arrival, which is why it is the one that aims.

              And a jump from here closes the sheet first: the record it lands on
              is under the backdrop, so scrolling to it without closing would put
              the reviewer somewhere they cannot see. */}
          <ReviewComments
            {...props}
            aimedAt={0}
            jumpTo={(rid) => {
              comments.setOpen(false)
              jumpTo(rid)
            }}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/**
 * What the glyph is called, which is the badge said out loud
 * (`r-badge-counts-settled`). Zero is a sentence rather than a number, because
 * zero is the state the badge itself stops rendering in and "0 unresolved
 * comments" is a reading of a badge that is not there.
 */
function unresolvedLabel(count: number): string {
  if (count === 0) return 'No unresolved comments on this review'
  if (count === 1) return '1 unresolved comment on this review'
  return `${count} unresolved comments on this review`
}

/**
 * What both mounts hold: the threads, then the composer under them.
 *
 * The threads scroll and the composer does not. A rail that scrolled as one
 * would put the composer below the fold on a review with a few threads on it,
 * and a composer you have to scroll to is the panel the reviewer had to scroll
 * up to, moved sideways.
 *
 * The thread area is rendered **even when it is empty**, which is the whole of
 * `r-sheet-composer-jump`: the composer used to be the first child of an empty
 * sheet, sitting at the top, and the first posted comment pushed it to the
 * bottom — the control being used moved the length of the panel. An empty flex
 * child costs nothing and holds the composer where its steady state has it.
 */
function ReviewComments({
  retroId,
  revision,
  readOnly,
  comments,
  records,
  jumpTo,
  aimedAt,
}: PanelProps & { aimedAt: number }) {
  const invalidate = useReviewThreadInvalidation()
  const anchorOf = anchorReader(records)

  return (
    // `min-w-0` twice down the chain: the panel is a flex item and so is its
    // scroller, and a flex item defaults to `min-width: auto` — it refuses to
    // shrink below its content, and a record thread's title does not wrap. Left
    // to itself the rail is 240px wide holding a 400px line, and the page that
    // must never scroll sideways scrolls sideways.
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3" data-testid="review-thread">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto">
        {comments.threads.map((thread) => (
          <ThreadCard
            key={thread.id}
            thread={thread}
            anchor={anchorOf(thread)}
            readOnly={readOnly}
            invalidate={invalidate}
            onJump={jumpTo}
          />
        ))}
      </div>

      {readOnly ? null : (
        <ReviewComposer
          retroId={retroId}
          revision={revision}
          comments={comments}
          records={records}
          invalidate={invalidate}
          aimedAt={aimedAt}
        />
      )}
    </div>
  )
}

/**
 * A thread's anchor line, or `null` when there is nothing true to say.
 *
 * `null` covers two states and renders the same in both: a thread about the
 * review, which hangs on no record, and a record thread whose record is not in
 * the revision on screen. The second is real — `threads.list` is the whole
 * retrospective and `records.list` is one revision of it, so a record dropped
 * from a later draft leaves its comments behind — and the honest thing to print
 * for it is nothing, because `#n · title` would be a number and a name this
 * page does not have.
 */
function anchorReader(records: readonly RecordSummary[]): (thread: Thread) => ThreadAnchor | null {
  const byRid = new Map(records.map((record) => [record.rid, record]))

  return (thread: Thread) => {
    if (thread.rid === null || thread.section === null) return null
    const record = byRid.get(thread.rid)
    if (record === undefined) return null
    return {
      rid: record.rid,
      globalId: record.globalId,
      title: record.title,
      section: SECTION_TITLES[thread.section],
      sectionKey: thread.section,
    }
  }
}

/**
 * The page's one composer, and the chip that says where the next comment lands.
 *
 * Without a chip this control would be ambiguous in the way the whole change is
 * meant to remove: the reviewer presses Comment on a section, the panel is
 * already full of other people's threads, and nothing on screen says the box
 * they are typing into is now aimed somewhere other than the review. The chip is
 * that sentence, and its × is how the aim is taken back.
 *
 * The anchor clears itself on a successful post. A sticky aim is how a thought
 * about the round ends up filed under whichever record was last clicked.
 */
function ReviewComposer({
  retroId,
  revision,
  comments,
  records,
  invalidate,
  aimedAt,
}: {
  retroId: number
  revision: number
  comments: ReviewComments
  records: readonly RecordSummary[]
  invalidate: Invalidate
  aimedAt: number
}) {
  const trpc = useTRPC()
  /**
   * The box stands open, so it is never unmounted to empty it the way a reply
   * box is when its Cancel or its post closes it. A posted comment starts the
   * next round instead, and a new round is a new empty box.
   */
  const [round, setRound] = useState(0)
  const { anchor, clearAnchor } = comments
  const open = useMutation(
    trpc.threads.open.mutationOptions({
      onSuccess: () => {
        setRound((previous) => previous + 1)
        clearAnchor()
        return invalidate()
      },
    }),
  )

  const aimed = anchor === null ? undefined : records.find((record) => record.rid === anchor.rid)

  return (
    <div className="flex flex-col gap-2">
      {anchor === null || aimed === undefined ? null : (
        <div
          className="flex min-w-0 items-center gap-2 rounded-lg border border-hairline bg-surface px-2.5 py-1.5"
          data-testid="composer-anchor"
        >
          {/* The thread header's pattern, because the chip is a header too: the
              same `#num · Section · title` in the same two-line budget
              (`comment-threads.tsx`, `r-thread-header-format`). Two copies of
              one line is how the panel and its composer drift, so neither
              changes without the other. */}
          <span className="meta-mono line-clamp-2 min-w-0" data-testid="anchor-line">
            #{aimed.globalId} · {SECTION_TITLES[anchor.section]} · {aimed.title}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            className="ml-auto shrink-0 text-muted-foreground"
            data-testid="composer-anchor-clear"
            aria-label="Comment on the review instead"
            onClick={clearAnchor}
          >
            <XIcon aria-hidden />
          </Button>
        </div>
      )}

      <ComposerBox
        key={round}
        testid="open-thread-submit"
        placeholder={anchor === null ? 'Something about the review as a whole' : 'Comment'}
        pending={open.isPending}
        aimedAt={aimedAt}
        onPost={(text) =>
          open.mutate({
            retroId,
            revision,
            target:
              anchor === null
                ? { kind: 'review' }
                : { kind: 'record', rid: anchor.rid, section: anchor.section },
            text,
          })
        }
      />
    </div>
  )
}

/**
 * Every comment on the page is `threads.list` now, so there is one query to make
 * stale — the record queries used to carry a record's threads and carry none of
 * them now (`views.schema.ts` §recordDetailSchema).
 *
 * The mutation's own result is not written into the cache: the refetched query
 * is the truth, which is also what makes the AI's replies and the human's
 * arrive by the same path.
 */
function useReviewThreadInvalidation(): Invalidate {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: trpc.threads.pathKey() })
}
