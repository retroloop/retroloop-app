import type { AppRouterOutputs } from '@retro/api'
import { BotIcon, ListFilterIcon, UserIcon, XIcon } from 'lucide-react'
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  DECISION_STATES,
  DECISION_TAG,
  type DecisionState,
} from '@/components/review/decision-state'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

type RecordSummary = AppRouterOutputs['records']['list']['records'][number]
type Party = RecordSummary['requester']
type RecordType = RecordSummary['type']

/**
 * The two slices behind the filter icon (`r-additional-filters`), and the words
 * for them.
 *
 * **Requester carries icons and type does not**, and the difference is not a
 * layout preference. The card header already renders requester as an icon and a
 * word (`record-card.tsx`, `REQUESTER_TAG`), so reusing `UserIcon`/`BotIcon`
 * here costs the reviewer nothing to learn — it is the vocabulary they are
 * already reading. Type has no such vocabulary: the card renders it as a
 * word-only badge, so any icon chosen here would be a mapping born in this
 * popover, paid for by no record, that a reader would have to decode. The word
 * is what the product already says, so the word is all this says.
 */
const REQUESTERS: readonly {
  readonly value: Party
  readonly label: string
  readonly icon: typeof UserIcon
}[] = [
  { value: 'human', label: 'Human', icon: UserIcon },
  { value: 'ai', label: 'AI', icon: BotIcon },
]

const TYPES: readonly { readonly value: RecordType; readonly label: string }[] = [
  { value: 'issue', label: 'Issue' },
  { value: 'feature', label: 'Feature' },
]

/**
 * The owner's review workflow (KC-0021, G5): filter to pending, and as each
 * record is decided it falls out of the filter and the page follows to the next
 * one still waiting. It reverses v0's no-filters principle for whole records —
 * and only for whole records. Nothing here ever hides part of one.
 *
 * Three things have to be true at once for that workflow to feel like work
 * rather than like the page losing its place:
 *
 *   - a decided record *departs* rather than blinking out, so the reviewer sees
 *     which record left and why (ledger v2 #63);
 *   - the viewport lands on the record that is next in the filter, or on the
 *     review's own actions when nothing is left (#95) — and the keyboard lands
 *     with it (retro 3 `r-departure-keyboard-focus`), because the card the
 *     reviewer was working in leaves the document and focus falls to `<body>`
 *     otherwise: a full tab-walk from the top of the page, per verdict;
 *   - the chips carry live counts, so the pending count is visible from the top
 *     of the page and not only from the bottom of it (#24).
 *
 * The state lives here and nowhere else: no URL parameter, because a filter is
 * where the reviewer is up to, not what the page is showing.
 */

/**
 * How long a record takes to leave. Long enough to be seen, short enough not to
 * be waited on — and the single source of the number, read by both the collapse
 * and the timer that removes the record, so the animation cannot outlive the row
 * it is animating or finish early and leave it sitting there collapsed.
 */
const DEPARTURE_MS = 240

/** A stable empty list, so a page whose query has not answered keeps identity. */
const NO_RECORDS: readonly RecordSummary[] = []

export type RecordFilter = {
  /** The states the reviewer has switched on. Empty means: show everything. */
  readonly active: ReadonlySet<DecisionState>
  /**
   * A tally over **every** record, and it stays that way when the extra filters
   * narrow the list — the owner's own lean: *"should the count be the total or
   * should it only show what is the number? I guess it should show total."* The
   * chips answer "how much is there", not "how much is on screen".
   */
  readonly counts: Readonly<Record<DecisionState, number>>
  readonly toggle: (state: DecisionState) => void
  /** Who raised it, and what it is — the two slices behind the filter icon. */
  readonly requesters: ReadonlySet<Party>
  readonly types: ReadonlySet<RecordType>
  readonly toggleRequester: (party: Party) => void
  readonly toggleType: (type: RecordType) => void
  /** One press undoes every extra filter, leaving the state chips alone. */
  readonly clearExtra: () => void
  readonly extraApplied: boolean
  readonly requesterCounts: Readonly<Record<Party, number>>
  readonly typeCounts: Readonly<Record<RecordType, number>>
  /**
   * Set when the filters — any of them — have hidden everything there was
   * (`r-empty-filter-message`). `null` on a list with records in it, and on a
   * retrospective that has none of its own: emptiness the filters did not cause
   * is not emptiness they can explain.
   */
  readonly emptied: { readonly decidedHidden: number } | null
  /** The records to render, in list order, including any still departing. */
  readonly shown: readonly RecordSummary[]
  readonly departing: ReadonlySet<string>
  readonly slotRef: (rid: string) => (element: HTMLElement | null) => void
  /**
   * The review's own actions, which are where a reviewer is put down when the
   * filter has nothing left in it. The page hands them over rather than this
   * hook going looking for them: a landing target found by querying the
   * document is a landing target that silently stops existing.
   */
  readonly actionsRef: (element: HTMLElement | null) => void
  /**
   * Put the reviewer down on a record, wherever they are. It is the same act
   * whether the page decided to move (a record departed), the reviewer asked for
   * it (the index rail, G2) or a link from the records page arrived pointing at
   * one — so it is one implementation: two would be two chances for a landing to
   * end up somewhere the other one would not. It answers whether there was a
   * record to land on, which is how a caller can tell "not there" from "arrived".
   */
  readonly jumpTo: (rid: string, landing?: Landing) => boolean
}

/**
 * How the page gets there.
 *
 * `smooth` is for a page that moved **on its own** — a record departed, or the
 * reviewer pressed something on a page they were already reading — where the
 * travel is what says which way the list went. `instant` is for **arriving**: a
 * reader who followed a link from the records page was never at the top of this
 * page, so animating away from a position they never held is motion that shows
 * them nothing. A reduced-motion preference makes both instant.
 */
export type Landing = 'smooth' | 'instant'

/**
 * Independent toggles, like the chips: any combination is a question the reviewer
 * might have, and none of them on is the page they started from.
 *
 * Module scope rather than the component body, so the callbacks that use it have
 * a stable identity to depend on.
 */
function toggled<T>(current: ReadonlySet<T>, value: T): ReadonlySet<T> {
  const next = new Set(current)
  if (!next.delete(value)) next.add(value)
  return next
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Take a departing row from the height it is standing at down to nothing.
 *
 * **The collapse was authored as a CSS transition and never once ran** (retro 10
 * `r-collapse-never-animates`). Two independent reasons, and the record named the
 * first; the trace found the second, which would have kept the row jumping even
 * with the first fixed.
 *
 *   - **`fr` values do not interpolate.** The slot declared a 0.24s transition on
 *     `grid-template-rows` and swapped `grid-rows-[1fr]` for `grid-rows-[0fr]`;
 *     the engine had nothing to tween and applied the change in one frame.
 *   - **The row's DOM node is destroyed and rebuilt as it leaves.** A verdict
 *     lands, `records` updates, and in that render the record no longer matches
 *     the filter and is not yet in `departing` — so the slot unmounts. The effect
 *     then marks it departing and it mounts *again*, a different element, already
 *     in the state it was supposed to animate towards. A transition needs a
 *     previous value and a freshly mounted node has none.
 *
 * Instrumented rather than reasoned about, per testing.md: the trace samples the
 * traced node and the live one every frame, and it reads `same=false` from the
 * moment the departure begins. That is why this is an animation started from the
 * element that is actually on screen — `RecordSlot` runs it in a layout effect on
 * the mount that *is* the departure — instead of a class swap on a node the page
 * has already thrown away.
 *
 * The height is measured rather than declared because there is nothing to
 * declare: a record's height is its content's, and the element is standing at it
 * when this is called.
 *
 * `height` on the slot rather than `grid-template-rows` in pixels: the row is
 * `1fr` of the slot's own box either way, so shrinking the box shrinks the row,
 * and the inner `min-h-0 overflow-hidden` clips exactly as it always did. And
 * `fill: 'forwards'` because the row has to stay collapsed for the rest of the
 * fifth of a second before the timer takes it out of the list.
 *
 * `interpolate-size: allow-keywords` would animate `height: auto` with no
 * measurement at all and was rejected on purpose: Chrome has it and Safari does
 * not, and the owner reviews on an iPad — a fix that animates in the test and
 * jumps on his screen is the defect with better test coverage.
 */
function collapse(element: HTMLElement | null): void {
  if (element === null || prefersReducedMotion()) return
  element.animate(
    [
      { height: `${element.getBoundingClientRect().height}px`, opacity: 1 },
      { height: '0px', opacity: 0 },
    ],
    { duration: DEPARTURE_MS, easing: 'ease-out', fill: 'forwards' },
  )
}

export function useRecordFilter(records: readonly RecordSummary[] = NO_RECORDS): RecordFilter {
  const [active, setActive] = useState<ReadonlySet<DecisionState>>(() => new Set())
  const [departing, setDeparting] = useState<ReadonlySet<string>>(() => new Set())
  /**
   * A record has finished leaving and the page owes the reviewer a landing. It
   * carries the filter it left under, because a chip pressed mid-departure
   * makes the whole list something else and scrolling into it would be the
   * page moving on its own.
   */
  const [landing, setLanding] = useState<{
    readonly after: string
    readonly under: ReadonlySet<DecisionState>
  } | null>(null)

  const [requesters, setRequesters] = useState<ReadonlySet<Party>>(() => new Set())
  const [types, setTypes] = useState<ReadonlySet<RecordType>>(() => new Set())

  const toggle = useCallback((state: DecisionState) => {
    setActive((current) => toggled(current, state))
  }, [])

  const toggleRequester = useCallback((party: Party) => {
    setRequesters((current) => toggled(current, party))
  }, [])

  const toggleType = useCallback((type: RecordType) => {
    setTypes((current) => toggled(current, type))
  }, [])

  const clearExtra = useCallback(() => {
    setRequesters(new Set())
    setTypes(new Set())
  }, [])

  const counts = useMemo(() => {
    const tally = {} as Record<DecisionState, number>
    for (const state of DECISION_STATES) tally[state] = 0
    for (const record of records) tally[record.state] += 1
    return tally
  }, [records])

  const requesterCounts = useMemo(() => {
    const tally = { human: 0, ai: 0 } as Record<Party, number>
    for (const record of records) tally[record.requester] += 1
    return tally
  }, [records])

  const typeCounts = useMemo(() => {
    const tally = { issue: 0, feature: 0 } as Record<RecordType, number>
    for (const record of records) tally[record.type] += 1
    return tally
  }, [records])

  /**
   * The three dimensions narrow together rather than replacing each other, which
   * is what makes "AI issues, still pending" a question the bar can answer. A
   * record on its way out is shown whatever the filters say: for the fifth of a
   * second it takes to leave, it is still where the reviewer left it.
   */
  const shown = useMemo(
    () =>
      records.filter(
        (record) =>
          departing.has(record.rid) ||
          ((active.size === 0 || active.has(record.state)) &&
            (requesters.size === 0 || requesters.has(record.requester)) &&
            (types.size === 0 || types.has(record.type))),
      ),
    [records, active, requesters, types, departing],
  )

  /**
   * The owner: *"it looks like a bug that all of a sudden everything vanished
   * when actually the the filtered items really don't have anything left"*. The
   * count is of the records that are **decided** and hidden, because that is
   * what the sentence beside it claims — counting every hidden record under that
   * word would make the page say something untrue on a filter that hid only
   * pending ones.
   */
  const emptied = useMemo(() => {
    const filtering = active.size > 0 || requesters.size > 0 || types.size > 0
    if (!filtering || shown.length > 0 || records.length === 0) return null
    return {
      decidedHidden: records.filter((record) => record.state !== 'pending').length,
    }
  }, [active, requesters, types, shown, records])

  const slots = useRef(new Map<string, HTMLElement>())
  const registrars = useRef(new Map<string, (element: HTMLElement | null) => void>())
  const slotRef = useCallback((rid: string) => {
    const known = registrars.current.get(rid)
    if (known !== undefined) return known
    const register = (element: HTMLElement | null) => {
      if (element === null) slots.current.delete(rid)
      else slots.current.set(rid, element)
    }
    registrars.current.set(rid, register)
    return register
  }, [])

  const actions = useRef<HTMLElement | null>(null)
  const actionsRef = useCallback((element: HTMLElement | null) => {
    actions.current = element
  }, [])

  /**
   * Put the keyboard where the page just put the eye.
   *
   * `preventScroll`, always: the landing already has a scroller and it is the
   * one below, which knows about the sticky header and about the reviewer's
   * motion preference. A second one racing it would be the page moving twice.
   */
  const focusWithoutScrolling = useCallback((element: HTMLElement | null | undefined): void => {
    element?.focus({ preventScroll: true })
  }, [])

  /**
   * Scroll a record's slot to the top of the reading area, and say whether there
   * was one to scroll to. A record the filter is hiding has no slot in the
   * document, so this is also the honest answer to "can the reviewer be taken
   * there": no, and nothing moves.
   */
  const scrollToSlot = useCallback((rid: string, landing: Landing = 'smooth'): boolean => {
    const target = slots.current.get(rid)
    if (target === undefined) return false
    target.scrollIntoView({
      behavior: landing === 'instant' || prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'start',
    })
    return true
  }, [])

  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  useEffect(() => {
    const running = timers.current
    return () => {
      for (const timer of running.values()) clearTimeout(timer)
      running.clear()
    }
  }, [])

  /**
   * What the reviewer just did to the list. A verdict that moves a record out
   * of the filter is a departure; a chip they pressed themselves is not, and
   * neither is the first paint — those two just redraw.
   */
  const seen = useRef<{
    readonly states: ReadonlyMap<string, DecisionState>
    readonly active: ReadonlySet<DecisionState>
    readonly requesters: ReadonlySet<Party>
    readonly types: ReadonlySet<RecordType>
  } | null>(null)
  useEffect(() => {
    const before = seen.current
    seen.current = {
      states: new Map(records.map((record) => [record.rid, record.state])),
      active,
      requesters,
      types,
    }
    // A *verdict* that moves a record out of the filter is a departure. A filter
    // the reviewer changed themselves is not — on any of the three dimensions,
    // which is why all three are compared here and not just the chips.
    if (
      before === null ||
      before.active !== active ||
      before.requesters !== requesters ||
      before.types !== types ||
      active.size === 0
    ) {
      return
    }

    for (const record of records) {
      const was = before.states.get(record.rid)
      if (was === undefined || was === record.state) continue
      if (!active.has(was) || active.has(record.state)) continue
      if (timers.current.has(record.rid)) continue

      const rid = record.rid
      setDeparting((current) => new Set(current).add(rid))
      timers.current.set(
        rid,
        setTimeout(
          () => {
            timers.current.delete(rid)
            setDeparting((current) => {
              const next = new Set(current)
              next.delete(rid)
              return next
            })
            setLanding({ after: rid, under: active })
          },
          prefersReducedMotion() ? 0 : DEPARTURE_MS,
        ),
      )
    }
  }, [records, active, requesters, types])

  useEffect(() => {
    if (landing === null) return
    setLanding(null)
    if (landing.under !== active) return

    // This runs in the commit that took the departed record out, so `shown` is
    // already the list without it: the successor is simply the next record in
    // it, or the one before if the departed record was last.
    const order = records.map((record) => record.rid)
    const from = order.indexOf(landing.after)
    if (from === -1) return
    const left = new Set(shown.map((record) => record.rid))
    const successor =
      order.slice(from + 1).find((rid) => left.has(rid)) ??
      order.slice(0, from).findLast((rid) => left.has(rid))

    if (successor !== undefined && scrollToSlot(successor)) {
      focusWithoutScrolling(slots.current.get(successor))
      return
    }
    // Nothing matches any more, so the only thing left to do is the review's own
    // one act — and since session 7 that act is in the sticky bar, which never
    // left the screen. The landing is a focus move and nothing else: it used to
    // scroll the page to its own end, which is where the actions used to be.
    focusWithoutScrolling(actions.current)
  }, [landing, active, records, shown, scrollToSlot, focusWithoutScrolling])

  return {
    active,
    counts,
    toggle,
    requesters,
    types,
    toggleRequester,
    toggleType,
    clearExtra,
    extraApplied: requesters.size > 0 || types.size > 0,
    requesterCounts,
    typeCounts,
    emptied,
    shown,
    departing,
    slotRef,
    actionsRef,
    jumpTo: scrollToSlot,
  }
}

/**
 * One record's place in the list. It holds the scroll anchor and the departure:
 * the row collapses from its own height to nothing while it fades, so the
 * records below rise into the gap instead of jumping into it — which is a true
 * sentence since retro 10 and was not before it (`collapse` above, and
 * `r-collapse-never-animates` for the four sessions in which this comment
 * described something the browser was not doing).
 *
 * The collapse itself is not here any more. It is an animation started where the
 * departure is decided, because that is the one place the row's own height can
 * still be read; what this keeps is the row's resting shape and the fact that
 * nothing lands on a record on its way out.
 *
 * It is also the landing target for the keyboard, which is what `tabIndex={-1}`
 * is for: reachable by `.focus()`, never by tabbing, so the tab order a reviewer
 * walks is still the controls and nothing else. The browser's own focus ring
 * then marks the landed record for a reviewer who arrived by keyboard and stays
 * off for one who clicked — `:focus-visible` reads the last interaction, which
 * is exactly the distinction wanted here.
 */
export function RecordSlot({
  filter,
  rid,
  children,
}: {
  filter: RecordFilter
  rid: string
  children: ReactNode
}) {
  const leaving = filter.departing.has(rid)
  const box = useRef<HTMLDivElement | null>(null)

  /**
   * The departure, run on the element that is on screen.
   *
   * It is a layout effect and it fires on *mount*, because for a departing row
   * this mount is the departure: the node the reviewer was reading was unmounted
   * one commit earlier, when the verdict took the record out of the filter and
   * before anything had marked it as leaving (`collapse` above). So there is no
   * earlier element to have started anything on, and this one is standing at its
   * full height with nothing yet drawn — which is exactly the value the collapse
   * needs to start from, and exactly the frame it has to start on.
   */
  const register = filter.slotRef(rid)
  const attach = useCallback(
    (element: HTMLDivElement | null) => {
      box.current = element
      register(element)
    },
    [register],
  )
  useLayoutEffect(() => {
    if (leaving) collapse(box.current)
  }, [leaving])

  return (
    <div
      ref={attach}
      tabIndex={-1}
      data-testid={`slot-${rid}`}
      // `scroll-mt-20` clears the sticky header (h-14) with the page's own gap
      // to spare, so a record landed on is not tucked under the breadcrumb.
      // `scroll-mt-28` clears both strips of sticky chrome — the app header
      // (h-14) and the decision bar under it — so a record landed on starts
      // below the bar rather than behind it.
      className={cn(
        // One resting shape, and the animation drives the box from it. The row
        // is `1fr` of this element's own height, so an animated height is an
        // animated row and the inner clip does the rest.
        //
        // `min-h-0` is what lets the box shrink at all, and it is load-bearing
        // rather than defensive: this slot is an item of the reading column's
        // `flex-col`, so its automatic minimum size is its own content's
        // min-content height. Without it the collapse runs, clamps at the card's
        // full height for the whole fifth of a second, and the row disappears
        // when the timer removes it — which measures as the same jump the `fr`
        // transition produced, from a different cause. The trace showed exactly
        // that before this class went on.
        'grid min-h-0 grid-rows-[1fr] scroll-mt-28',
        // Nothing lands on a record that is on its way out: for the fifth of a
        // second it is still in the document it is no longer a thing the
        // reviewer can decide.
        filter.departing.has(rid) && 'pointer-events-none',
      )}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}

/**
 * Whether a chip for this state belongs on the bar at all.
 *
 * **Every state a review can reach keeps its chip at zero.** "No records are
 * declined" is itself an answer, and a bar whose length changed with the counts
 * would be harder to aim at — so `pending`, `approved`, `declined` and `revise`
 * (retro 4 `r-verdict-revise`) are always there.
 *
 * **`hold` is the one exception, and only when it is empty** (retro 4
 * `r-remove-hold`). It is not a state this product can reach any more: `hold`
 * stopped being a verdict in retro 3 `r-hold-semantics`, and nothing has written
 * one since. On every store the owner actually has, the chip is a control that
 * can only ever read zero and filter to nothing — permanently dead chrome, and
 * every element earns its place (CLAUDE.md).
 *
 * A store that *does* carry a hold verdict still gets the chip, because human
 * data is append-only and a verdict somebody once chose stays findable. This is
 * a rendering rule and nothing more: `record list --state hold`, the wire enum,
 * the export and the decisions table's own CHECK all go on admitting one
 * (data-model.md §Read-only historical `hold` verdicts).
 */
function chipBelongs(state: DecisionState, count: number): boolean {
  return state !== 'hold' || count > 0
}

/**
 * The decision bar: what the reviewer is looking for on the left, the one thing
 * they can do about it on the right — and it **stays** (owner, session 7:
 * *"When I scroll the filter (pending, approved and declined etc) they scroll
 * away; I want them to stick to the top. Also I want the box at the bottom … I
 * want it removed and just add a button next to the filters (filters on the
 * left, finish button on the right)."*).
 *
 * `top-14` is the app header's own height, so the bar comes to rest against it
 * with nothing showing between the two, and `z-20` puts it under the header and
 * over the records that pass beneath it. The background is opaque rather than
 * the header's translucent one: a record sliding under a blurred bar is a
 * record you can still half read, which is worse than one you cannot.
 *
 * It is the reading column's own strip rather than a fourth thing in the page
 * chrome — the counts are about the records beside it, and the act is about
 * them too — so it is as wide as that column and the rails keep their own
 * sticky offsets.
 */
export function RecordFilterBar({ filter, action }: { filter: RecordFilter; action?: ReactNode }) {
  return (
    <div
      data-testid="review-bar"
      className="sticky top-14 z-20 flex flex-wrap items-center gap-x-3 gap-y-2 bg-background py-2.5"
    >
      <RecordFilterChips filter={filter} />
      <ExtraFilters filter={filter} />
      {action}
    </div>
  )
}

/**
 * The chips: the four live states, plus `hold` on the stores that hold one.
 *
 * They are independent toggles rather than one selector: any combination is a
 * question the reviewer might have, and none of them selected is the v0 page,
 * which is what a reviewer who never presses a chip keeps.
 */
function RecordFilterChips({ filter }: { filter: RecordFilter }) {
  return (
    // A fieldset, because that is what a group of related controls is; the
    // label is for a screen reader, which otherwise hears the toggles with no
    // word for what they do to the page.
    //
    // `min-w-0`: it is a flex item on a bar that also carries an action, and a
    // flex item that refuses to shrink is how a bar starts scrolling sideways.
    <fieldset
      aria-label="Show only records in these states"
      data-testid="record-filter"
      className="flex min-w-0 flex-wrap items-center gap-2"
    >
      {DECISION_STATES.filter((state) => chipBelongs(state, filter.counts[state])).map((state) => {
        const { fill, label, icon: Icon } = DECISION_TAG[state]
        const on = filter.active.has(state)
        const count = filter.counts[state]
        return (
          <button
            key={state}
            type="button"
            aria-pressed={on}
            data-testid={`filter-${state}`}
            onClick={() => filter.toggle(state)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium text-xs transition-colors',
              on
                ? cn(fill, 'border-transparent')
                : cn(
                    'border-hairline hover:bg-accent',
                    count === 0 ? 'text-muted-foreground' : 'text-foreground',
                  ),
            )}
          >
            <Icon aria-hidden className="size-3.5" />
            {label}
            <span className="font-semibold tabular-nums" data-testid={`filter-${state}-count`}>
              {count}
            </span>
          </button>
        )
      })}
    </fieldset>
  )
}

/**
 * The two slices the bar could not afford inline, behind the icon the owner
 * asked for (`r-additional-filters`).
 *
 * He priced the alternative himself before proposing this: *"maybe we can keep
 * what we have and then we can add a icon with filter … so when you click it
 * show a pop-up and there you can select the additional filters"*. Two more chip
 * families would wrap this bar to three lines at the width he reviews on, and
 * the bar's whole point is that it stays.
 *
 * The applied state is readable **without opening it**, which is the other half
 * of what he asked for — *"we will have to show some indication that extra
 * filters are applied"*. Two marks rather than one, and they answer different
 * questions: the badge says *something* is filtering, from anywhere on the bar;
 * the chip beside it says *what*, so a short list is never a mystery. The chip
 * carries the only way to undo them, because that is where the reviewer is
 * looking when they wonder.
 */
function ExtraFilters({ filter }: { filter: RecordFilter }) {
  return (
    <div className="flex items-center gap-2" data-testid="filter-extra">
      <Popover>
        <PopoverTrigger
          type="button"
          data-testid="filter-more"
          aria-label="More filters"
          className={cn(
            'relative inline-flex items-center rounded-full border p-1.5 transition-colors',
            filter.extraApplied
              ? 'border-transparent bg-accent text-foreground'
              : 'border-hairline text-muted-foreground hover:bg-accent',
          )}
        >
          <ListFilterIcon aria-hidden className="size-3.5" />
          {filter.extraApplied ? (
            // A dot rather than a number: how many extra filters are on is not a
            // question anyone asks, and the chip beside it already names them.
            <span
              data-testid="filter-more-badge"
              className="-top-0.5 -right-0.5 absolute size-2 rounded-full bg-tone-blue"
            >
              <span className="sr-only">Extra filters are applied</span>
            </span>
          ) : null}
        </PopoverTrigger>

        <PopoverContent align="start" data-testid="filter-more-panel" className="w-56">
          <ExtraFilterGroup
            label="Raised by"
            kind="requester"
            options={REQUESTERS}
            active={filter.requesters}
            counts={filter.requesterCounts}
            onToggle={filter.toggleRequester}
          />
          <ExtraFilterGroup
            label="Kind"
            kind="type"
            options={TYPES}
            active={filter.types}
            counts={filter.typeCounts}
            onToggle={filter.toggleType}
          />
        </PopoverContent>
      </Popover>

      {filter.extraApplied ? (
        <span
          data-testid="filter-applied"
          className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 font-medium text-foreground text-xs"
        >
          {appliedLabel(filter)}
          <button
            type="button"
            data-testid="filter-applied-clear"
            aria-label="Clear the extra filters"
            onClick={filter.clearExtra}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <XIcon aria-hidden className="size-3.5" />
          </button>
        </span>
      ) : null}
    </div>
  )
}

/** What is filtering, in the reviewer's own reading order: who, then what. */
function appliedLabel(filter: RecordFilter): string {
  return [
    ...REQUESTERS.filter((one) => filter.requesters.has(one.value)),
    ...TYPES.filter((one) => filter.types.has(one.value)),
  ]
    .map((one) => one.label)
    .join(' · ')
}

/**
 * One slice, with its per-value counts.
 *
 * The counts here are the ones that answer *his* question — *"the user can also
 * see the count of like how many issues AI issues? How many issues are human
 * issues?"* — and they are counted over every record, like the chips', so
 * opening the popover never changes the numbers inside it.
 */
function ExtraFilterGroup<T extends string>({
  label,
  kind,
  options,
  active,
  counts,
  onToggle,
}: {
  label: string
  kind: 'requester' | 'type'
  options: readonly {
    readonly value: T
    readonly label: string
    /** Only where the product already draws one for this fact — see `TYPES`. */
    readonly icon?: typeof UserIcon
  }[]
  active: ReadonlySet<T>
  counts: Readonly<Record<T, number>>
  onToggle: (value: T) => void
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="section-label pb-1 text-muted-foreground">{label}</legend>
      {options.map(({ value, label: name, icon: Icon }) => {
        const on = active.has(value)
        return (
          <button
            key={value}
            type="button"
            aria-pressed={on}
            data-testid={`filter-${kind}-${value}`}
            onClick={() => onToggle(value)}
            className={cn(
              'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
              on ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60',
            )}
          >
            {Icon === undefined ? null : <Icon aria-hidden className="size-3.5 shrink-0" />}
            <span className="flex-1">{name}</span>
            <span
              className="font-semibold tabular-nums"
              data-testid={`filter-${kind}-${value}-count`}
            >
              {counts[value]}
            </span>
          </button>
        )
      })}
    </fieldset>
  )
}

/**
 * What the reading column says when the filters have hidden everything
 * (`r-empty-filter-message`, owner-approved).
 *
 * The owner, at the end of a round: *"in the end when there is no more pending
 * it doesn't show me a nice and sweet message that says hey there are no more
 * items that match the selected criteria, something like that so otherwise it
 * looks like a bug that all of a sudden everything vanished when actually the
 * the filtered items really don't have anything left."* The list simply ended
 * before this, and an empty column reads as a fault rather than as done.
 *
 * It names the **state**, not the chips that produced it: any combination of the
 * three filter dimensions can arrive here, and a sentence that recited them
 * would be a second copy of the bar directly under the bar.
 *
 * The count clause rides along only when there is something to count. "0 decided
 * records are hidden" is true, and it reads exactly like the bug this exists to
 * stop looking like — while calling every hidden record "decided" would be false
 * on a filter that hid only pending ones. So the sentence that is always true is
 * always said, and the number joins it when it has something to say.
 */
export function EmptiedFilter({ filter }: { filter: RecordFilter }) {
  if (filter.emptied === null) return null
  const { decidedHidden } = filter.emptied

  return (
    <p
      data-testid="filter-empty"
      className="rounded-lg border border-hairline bg-surface px-4 py-3 text-muted-foreground text-sm"
    >
      No records match the selected filters
      {decidedHidden === 0 ? null : (
        <>
          {' — '}
          <span className="font-semibold tabular-nums" data-testid="filter-empty-hidden">
            {decidedHidden}
          </span>
          {decidedHidden === 1 ? ' decided record is hidden' : ' decided records are hidden'}
        </>
      )}
    </p>
  )
}
