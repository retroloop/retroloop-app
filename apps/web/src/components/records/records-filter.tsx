import { ListFilterIcon, TagIcon, XIcon } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { ACTOR_TAG, type Party } from '@/components/actor-tag'
import {
  LIFECYCLE_STATES,
  LIFECYCLE_TAG,
  type LifecycleState,
  type RecordListRow,
} from '@/components/records/record-lifecycle'
import {
  DECISION_STATES,
  DECISION_TAG,
  type DecisionState,
} from '@/components/review/decision-state'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { TagLook } from '@/components/ui/tag'
import { cn } from '@/lib/utils'

/**
 * The four questions this page can be narrowed by, and no more (A6: no free-text
 * search in round one, and the deferred list stays deferred).
 *
 * They are **independent toggles that compose**, like the review page's chips:
 * any combination is a question the owner might have — *"this is going to be for
 * the use cases like to see what issues have been resolved"* is one of them, and
 * "the AI's issues that are still open" is another — and none of them on is the
 * whole list, which is the page a reader who presses nothing keeps.
 *
 * **Label is the fourth, and it is the one the owner asked for by name**: *"they
 * can filter on the label"* was his whole argument for why labels beat a comment
 * carrying the same words. It joins the popover rather than the bar because the
 * vocabulary is unbounded — a store with fifteen labels would wrap the bar to
 * four lines, and lifecycle is what this page is *for*
 * (`r-additional-filters` made the same call for verdict and requester).
 *
 * **Attribute filters are deferred**, and deliberately: a value filter is a
 * different control entirely — a name, an operator and a value — and no
 * evidence yet says which of the four types wants one. FOR HIS REVIEW.
 *
 * **The counts are over every record, always**, on all four dimensions, and
 * they do not move when a filter narrows the list. That is the owner's own
 * ruling on the review bar's chips — *"should the count be the total or should
 * it only show what is the number? I guess it should show total"* — and the same
 * reason applies here: the chips answer "how much is there", not "how much is on
 * screen", and a number that changed as you filtered could not be aimed at.
 */
export type RecordsFilter = {
  readonly lifecycle: ReadonlySet<LifecycleState>
  readonly states: ReadonlySet<DecisionState>
  readonly requesters: ReadonlySet<Party>
  /** By definition id, never by name — a rename must not drop a filter. */
  readonly labels: ReadonlySet<number>
  readonly toggleLifecycle: (status: LifecycleState) => void
  readonly toggleState: (state: DecisionState) => void
  readonly toggleRequester: (party: Party) => void
  readonly toggleLabel: (labelId: number) => void
  readonly lifecycleCounts: Readonly<Record<LifecycleState, number>>
  readonly stateCounts: Readonly<Record<DecisionState, number>>
  readonly requesterCounts: Readonly<Record<Party, number>>
  /**
   * How many records wear each label, by definition id — and the **vocabulary
   * this page has actually seen**, taken off the rows rather than from
   * `labels.list`.
   *
   * That is the same call the verdict chips make about `hold`: a filter that
   * could only ever read zero and narrow to nothing is a control that has
   * earned nothing. Reading the rows also means this page needs no second
   * query — every label it can offer is on a row it is already holding — and a
   * label nobody has applied is simply not a question anyone can ask here yet.
   */
  readonly labelCounts: readonly {
    readonly id: number
    readonly name: string
    readonly count: number
  }[]
  /** One press undoes the three behind the icon, leaving the lifecycle chips alone. */
  readonly clearExtra: () => void
  readonly extraApplied: boolean
  /**
   * Set when the filters have hidden everything there was, with what they hid
   * (`r-empty-filter-message`). `null` on a list with rows in it, and on a store
   * with no records at all: emptiness the filters did not cause is not emptiness
   * they can explain.
   */
  readonly emptied: { readonly hidden: number } | null
  /** The rows to render, in the order the procedure sent them: newest retro first. */
  readonly shown: readonly RecordListRow[]
}

const REQUESTERS: readonly Party[] = ['human', 'ai']

/** A stable empty list, so a page whose query has not answered keeps identity. */
const NO_ROWS: readonly RecordListRow[] = []

function toggled<T>(current: ReadonlySet<T>, value: T): ReadonlySet<T> {
  const next = new Set(current)
  if (!next.delete(value)) next.add(value)
  return next
}

function tally<T extends string>(
  rows: readonly RecordListRow[],
  keys: readonly T[],
  of: (row: RecordListRow) => T,
): Record<T, number> {
  const counts = {} as Record<T, number>
  for (const key of keys) counts[key] = 0
  for (const row of rows) counts[of(row)] += 1
  return counts
}

/**
 * The lifecycle the filter opens on — the one the URL named, and only if it is
 * one this product has.
 *
 * **The router does not police what it narrows** (retro-13
 * `r-validatesearch-narrows-not-polices`, measured on two independently written
 * surfaces): `/records`'s validator returns `{}` for `?lifecycle=nonsense`, and
 * `useSearch()` still answers `nonsense`. Seeded straight into the filter, that
 * junk becomes a predicate no row satisfies — 0 of 132 records, with no chip
 * pressed to explain the emptiness, which reads as a product that lost its
 * corpus rather than as an address that was mistyped.
 *
 * So the value is checked where it is *used*, which is the shape the reference
 * fix took on the settings surface (`ae7e4d2`): an unrecognised lifecycle is no
 * lifecycle, the page opens on the whole corpus, and every chip is there to be
 * pressed. Returning an array rather than a value is what keeps the empty case
 * and the seeded case one expression.
 */
function seeded(seed: string | undefined): readonly LifecycleState[] {
  const known = LIFECYCLE_STATES.find((status) => status === seed)
  return known === undefined ? [] : [known]
}

/**
 * The filter state, and nothing else.
 *
 * It is **not** `useRecordFilter` from the review page, and the difference is
 * not duplication anybody overlooked. That hook is a review *workflow*: a record
 * departs when a verdict moves it out of the filter, the viewport lands on the
 * next one still waiting, and the keyboard follows so the next verdict is one
 * tab away. All three exist because the reviewer is deciding records while the
 * list changes under them. Nothing on this page decides anything — a filter here
 * is a predicate over rows the reader is browsing — so reusing that hook would
 * mean importing a workflow this page does not have, and then explaining why
 * half of it never fires.
 */
export function useRecordsFilter(
  rows: readonly RecordListRow[] = NO_ROWS,
  /**
   * The lifecycle state this page was **opened** on, from `?lifecycle=` — the
   * dashboard's open count links here already narrowed to what it counted.
   *
   * **Seed only, deliberately.** It is the initial value of the filter and
   * nothing writes back to the URL when the reader presses a chip, so the
   * address bar describes where they arrived rather than where they have got to.
   * The alternative — full two-way sync — makes every chip press a navigation,
   * puts the back button in the middle of a filtering session, and would have
   * rewritten every scenario in `records.feature` that presses one. A deep link
   * in is the whole of what the dashboard needs; the rest is a feature nobody
   * has asked for yet, and it stays on the deferred list with search and bulk
   * actions.
   *
   * **It is typed as a lifecycle state and checked as though it were not**, and
   * that is `r-validatesearch-narrows-not-polices` in one line: the route's
   * `validateSearch` returns `{}` for a value it does not recognise and
   * `Route.useSearch()` hands the junk straight back, so whatever the type says,
   * what arrives here is whatever was in the address bar. `seeded` below is the
   * point of use, which is the only place a guard cannot be bypassed.
   */
  seed?: LifecycleState,
): RecordsFilter {
  const [lifecycle, setLifecycle] = useState<ReadonlySet<LifecycleState>>(
    () => new Set(seeded(seed)),
  )
  const [states, setStates] = useState<ReadonlySet<DecisionState>>(() => new Set())
  const [requesters, setRequesters] = useState<ReadonlySet<Party>>(() => new Set())
  const [labels, setLabels] = useState<ReadonlySet<number>>(() => new Set())

  const toggleLifecycle = useCallback((status: LifecycleState) => {
    setLifecycle((current) => toggled(current, status))
  }, [])
  const toggleState = useCallback((state: DecisionState) => {
    setStates((current) => toggled(current, state))
  }, [])
  const toggleRequester = useCallback((party: Party) => {
    setRequesters((current) => toggled(current, party))
  }, [])
  const toggleLabel = useCallback((labelId: number) => {
    setLabels((current) => toggled(current, labelId))
  }, [])
  const clearExtra = useCallback(() => {
    setStates(new Set())
    setRequesters(new Set())
    setLabels(new Set())
  }, [])

  const lifecycleCounts = useMemo(
    () => tally(rows, LIFECYCLE_STATES, (row) => row.lifecycle.status),
    [rows],
  )
  const stateCounts = useMemo(() => tally(rows, DECISION_STATES, (row) => row.state), [rows])
  const requesterCounts = useMemo(() => tally(rows, REQUESTERS, (row) => row.requester), [rows])
  /**
   * The vocabulary as the rows show it, in the order the rows show it — which is
   * the vocabulary's own minting order, because that is the order the server
   * resolves a record's labels in (`definition.view.ts`). So the panel's list
   * reads in the same order as the settings page's, without this page holding
   * the settings page's query.
   */
  const labelCounts = useMemo(() => {
    const seen = new Map<number, { id: number; name: string; count: number }>()
    for (const row of rows) {
      for (const label of row.labels) {
        const known = seen.get(label.id)
        if (known === undefined) seen.set(label.id, { id: label.id, name: label.name, count: 1 })
        else known.count += 1
      }
    }
    return [...seen.values()]
  }, [rows])

  /**
   * The four dimensions narrow together rather than replacing each other.
   *
   * **Within the label dimension the chips are an OR**, like every other
   * dimension here: pressing `migrated` and `wontfix` asks for records wearing
   * either. An AND would be the more powerful question and the less likely one —
   * a record wearing two named labels is a query, and picking two classifications
   * off a list reads as "show me both kinds" to everyone who has used a tag
   * filter anywhere else.
   */
  const shown = useMemo(
    () =>
      rows.filter(
        (row) =>
          (lifecycle.size === 0 || lifecycle.has(row.lifecycle.status)) &&
          (states.size === 0 || states.has(row.state)) &&
          (requesters.size === 0 || requesters.has(row.requester)) &&
          (labels.size === 0 || row.labels.some((label) => labels.has(label.id))),
      ),
    [rows, lifecycle, states, requesters, labels],
  )

  const emptied = useMemo(() => {
    const filtering =
      lifecycle.size > 0 || states.size > 0 || requesters.size > 0 || labels.size > 0
    if (!filtering || shown.length > 0 || rows.length === 0) return null
    // Every row there is, because none of them is on screen — which is the
    // number that answers "did everything vanish, or does nothing match?".
    return { hidden: rows.length }
  }, [lifecycle, states, requesters, labels, shown, rows])

  return {
    lifecycle,
    states,
    requesters,
    labels,
    toggleLifecycle,
    toggleState,
    toggleRequester,
    toggleLabel,
    lifecycleCounts,
    stateCounts,
    requesterCounts,
    labelCounts,
    clearExtra,
    extraApplied: states.size > 0 || requesters.size > 0 || labels.size > 0,
    emptied,
    shown,
  }
}

/**
 * The bar: the page's own question on the left, everything else behind the icon.
 *
 * **Lifecycle is the one dimension that gets chips**, because it is what the
 * page is for — *"to see what issues have been resolved"*. Verdict and requester
 * go behind the filter icon for the reason `r-additional-filters` gives on the
 * review page: two more chip families would wrap this bar to three lines at the
 * width the owner reviews on, and a bar that wraps is a bar that stops being
 * worth sticking to the top.
 *
 * `top-14` is the app header's own height, so it comes to rest against it with
 * nothing showing between the two, and the background is opaque rather than the
 * header's translucent one — a row sliding under a blurred bar is a row you can
 * still half read, which is worse than one you cannot.
 */
export function RecordsFilterBar({ filter }: { filter: RecordsFilter }) {
  return (
    <div
      data-testid="records-bar"
      className="sticky top-14 z-20 flex flex-wrap items-center gap-x-3 gap-y-2 bg-background py-2.5"
    >
      <fieldset
        aria-label="Show only records in these lifecycle states"
        data-testid="records-lifecycle-filter"
        className="flex min-w-0 flex-wrap items-center gap-2"
      >
        {LIFECYCLE_STATES.map((status) => (
          <FilterChip
            key={status}
            testId={`records-filter-${status}`}
            look={LIFECYCLE_TAG[status]}
            on={filter.lifecycle.has(status)}
            count={filter.lifecycleCounts[status]}
            onToggle={() => filter.toggleLifecycle(status)}
          />
        ))}
      </fieldset>

      <ExtraFilters filter={filter} />
    </div>
  )
}

/**
 * One chip: a soft fill when it is on, a hairline outline when it is off, and
 * the count either way. It is the review bar's chip, to the class string —
 * written here rather than shared because there are two callers and this repo's
 * own rule for lifting markup into a primitive is the third (`components/ui/tag.tsx`:
 * *"Two copies of a class string is a coincidence; three is a rule nobody wrote
 * down"*). The two differ in what they are keyed by and in which of them may be
 * missing, so lifting them now would mean a component with a `kind` prop before
 * anyone knows what the third caller needs.
 */
function FilterChip({
  testId,
  look,
  on,
  count,
  onToggle,
}: {
  testId: string
  look: TagLook
  on: boolean
  count: number
  onToggle: () => void
}) {
  const { fill, label, icon: Icon } = look
  return (
    <button
      type="button"
      aria-pressed={on}
      data-testid={testId}
      onClick={onToggle}
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
      <span className="font-semibold tabular-nums" data-testid={`${testId}-count`}>
        {count}
      </span>
    </button>
  )
}

/**
 * Whether a verdict belongs in the list at all.
 *
 * Every verdict a review can reach keeps its row at zero — "nothing is declined"
 * is itself an answer. `hold` is the one exception and only when it is empty:
 * it stopped being a verdict anyone can give in retro 3 `r-hold-semantics`, so
 * on every store the owner actually has it is a control that can only ever read
 * zero and filter to nothing. A store that *does* carry one still gets it,
 * because human data is append-only and a verdict somebody once chose stays
 * findable. The review bar decides it the same way, for the same reasons.
 */
function verdictBelongs(state: DecisionState, count: number): boolean {
  return state !== 'hold' || count > 0
}

/**
 * The three slices the bar could not afford inline, behind the icon the owner
 * asked for on the review page and gets here in the same shape.
 *
 * **Label is the third, and it is the one that could never have gone on the
 * bar.** Verdict and requester are closed vocabularies — five values and two —
 * so a version of this page could have shown them as chips and merely chosen not
 * to. A label vocabulary is whatever the human typed into the settings page, so
 * the number of chips is unbounded and the bar would wrap to whatever a store
 * happens to hold. Behind the icon it costs one line per label in a panel that
 * scrolls.
 *
 * The applied state is readable **without opening it**, which is the other half
 * of what he asked for — *"we will have to show some indication that extra
 * filters are applied"*. Two marks, answering different questions: the badge
 * says *something* is filtering, from anywhere on the bar; the chip beside it
 * says *what*, and carries the only way to undo them, because that is where the
 * reader is looking when they wonder.
 */
function ExtraFilters({ filter }: { filter: RecordsFilter }) {
  return (
    <div className="flex items-center gap-2" data-testid="records-filter-extra">
      <Popover>
        <PopoverTrigger
          type="button"
          data-testid="records-filter-more"
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
            <span
              data-testid="records-filter-more-badge"
              className="-top-0.5 -right-0.5 absolute size-2 rounded-full bg-tone-blue"
            >
              <span className="sr-only">Extra filters are applied</span>
            </span>
          ) : null}
        </PopoverTrigger>

        <PopoverContent align="start" data-testid="records-filter-more-panel" className="w-56">
          <FilterGroup
            label="Verdict"
            kind="verdict"
            options={DECISION_STATES.filter((state) =>
              verdictBelongs(state, filter.stateCounts[state]),
            ).map((state) => ({ value: state, look: DECISION_TAG[state] }))}
            active={filter.states}
            counts={filter.stateCounts}
            onToggle={filter.toggleState}
          />
          <FilterGroup
            label="Raised by"
            kind="requester"
            options={REQUESTERS.map((party) => ({ value: party, look: ACTOR_TAG[party] }))}
            active={filter.requesters}
            counts={filter.requesterCounts}
            onToggle={filter.toggleRequester}
          />
          {/**
           * **Only when the store has one.** A label nobody has applied is not a
           * question anyone can ask on this page, and a heading over an empty
           * list is a control that has earned nothing — the same call
           * `verdictBelongs` makes about the verdict nobody can give any more.
           * On a store with no labels at all the panel is exactly what it was
           * before session 10.
           */}
          {filter.labelCounts.length === 0 ? null : (
            <FilterGroup
              label="Label"
              kind="label"
              options={filter.labelCounts.map((label) => ({
                value: String(label.id),
                testId: label.name,
                look: { fill: '', label: label.name, icon: TagIcon },
              }))}
              active={new Set([...filter.labels].map(String))}
              counts={Object.fromEntries(
                filter.labelCounts.map((label) => [String(label.id), label.count]),
              )}
              onToggle={(value) => filter.toggleLabel(Number(value))}
            />
          )}
        </PopoverContent>
      </Popover>

      {filter.extraApplied ? (
        <span
          data-testid="records-filter-applied"
          className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 font-medium text-foreground text-xs"
        >
          {appliedLabel(filter)}
          <button
            type="button"
            data-testid="records-filter-applied-clear"
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

/** What is filtering, in the panel's own reading order: verdict, who, then label. */
function appliedLabel(filter: RecordsFilter): string {
  return [
    ...DECISION_STATES.filter((state) => filter.states.has(state)).map(
      (state) => DECISION_TAG[state].label,
    ),
    ...REQUESTERS.filter((party) => filter.requesters.has(party)).map(
      (party) => ACTOR_TAG[party].label,
    ),
    ...filter.labelCounts.filter((label) => filter.labels.has(label.id)).map((label) => label.name),
  ].join(' · ')
}

/**
 * One slice, with its per-value counts — the same counts the chips carry, over
 * every record, so opening the panel never changes the numbers inside it.
 *
 * Each option wears the mark the product already draws for that value: the
 * verdict's own icon, the actor's own icon. Nothing is invented in this panel,
 * because a mapping born in a popover is a mapping the reader has to decode.
 */
function FilterGroup<T extends string>({
  label,
  kind,
  options,
  active,
  counts,
  onToggle,
}: {
  label: string
  kind: 'verdict' | 'requester' | 'label'
  /**
   * `value` is what the toggle sends and `testId` is what a scenario reaches
   * for. They are the same word for the two closed vocabularies and are not for
   * labels: a label is keyed by **id**, because a rename must not drop a filter
   * a reader has applied — and a testid built from an id would make every
   * scenario in `labels.feature` address `records-filter-label-3` instead of
   * `records-filter-label-wontfix`, which is a number a reader of the feature
   * cannot check.
   */
  options: readonly {
    readonly value: T
    readonly look: TagLook
    readonly testId?: string
  }[]
  active: ReadonlySet<T>
  counts: Readonly<Record<T, number>>
  onToggle: (value: T) => void
}) {
  return (
    <fieldset className="flex flex-col gap-1" data-testid={`records-filter-${kind}-group`}>
      <legend className="section-label pb-1 text-muted-foreground">{label}</legend>
      {options.map(({ value, look, testId = value }) => {
        const on = active.has(value)
        const Icon = look.icon
        return (
          <button
            key={value}
            type="button"
            aria-pressed={on}
            data-testid={`records-filter-${kind}-${testId}`}
            onClick={() => onToggle(value)}
            className={cn(
              'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
              on ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60',
            )}
          >
            <Icon aria-hidden className="size-3.5 shrink-0" />
            <span className="flex-1">{look.label}</span>
            <span
              className="font-semibold tabular-nums"
              data-testid={`records-filter-${kind}-${testId}-count`}
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
 * What the page says when the filters have hidden everything
 * (`r-empty-filter-message`, owner-approved on the review page and the same
 * sentence here).
 *
 * The owner, at the end of a round: *"it doesn't show me a nice and sweet
 * message that says hey there are no more items that match the selected
 * criteria … otherwise it looks like a bug that all of a sudden everything
 * vanished when actually the filtered items really don't have anything left."*
 *
 * It names the **state**, not the chips that produced it: any combination of the
 * three dimensions can arrive here, and a sentence that recited them would be a
 * second copy of the bar directly under the bar. The count is every record there
 * is, which is what the number means when none of them is on screen — and it is
 * the number that separates "the filters hid them" from "there are none".
 */
export function EmptiedRecords({ filter }: { filter: RecordsFilter }) {
  if (filter.emptied === null) return null
  const { hidden } = filter.emptied

  return (
    <p
      data-testid="records-empty-filter"
      className="rounded-lg border border-hairline bg-surface px-4 py-3 text-muted-foreground text-sm"
    >
      No records match the selected filters —{' '}
      <span className="font-semibold tabular-nums" data-testid="records-empty-filter-hidden">
        {hidden}
      </span>
      {hidden === 1 ? ' record is hidden' : ' records are hidden'}
    </p>
  )
}
