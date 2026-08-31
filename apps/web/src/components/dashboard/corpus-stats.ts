import {
  LIFECYCLE_STATES,
  type LifecycleState,
  type RecordListRow,
} from '@/components/records/record-lifecycle'
import { SEVERITIES } from '@/lib/enum-labels'

/**
 * **Every number the three dashboard variations draw, derived in one place.**
 *
 * This is the direction round's spine. The three variations disagree about what a
 * dashboard is *for* — a debt ledger, a work diary, an instrument panel — and
 * they draw different charts to argue it. What they must not disagree about is
 * the arithmetic: if variation A says 88 records are open and variation C says
 * 87, the owner is comparing two bugs rather than two designs, and the round is
 * wasted. So the counting happens here, once, and the variations only choose
 * which of these readings to show and how.
 *
 * **No new wire.** Every figure below is a pass over the rows `records.listAll`
 * and `retros.list` already serve — the same constraint the shipped dashboard
 * works under (`components/dashboard/corpus.tsx`), and for the same reason: a
 * per-retro or per-session count on the server is a wire widening, which is a
 * two-package change and a different lane's work (`r-wire-widening-two-package`).
 * The flat records page already holds every row for one user by design, which is
 * what makes counting them in the browser affordable.
 *
 * **Pure data, so the readings are provable without a browser.** A chart is the
 * hardest thing in this product to assert against and the easiest to get subtly
 * wrong — an off-by-one in a cumulative series draws a picture that is wrong in a
 * way no screenshot review catches. Keeping the arithmetic here means the picture
 * is wrong only if the numbers are, and the numbers are checkable.
 */

/** How much of one bucket is where, on the axis that outlives the review. */
export type Split = {
  readonly total: number
  readonly open: number
  readonly resolved: number
  readonly archived: number
}

/** A bucket of the corpus: what it is called, and how it splits. */
export type Bucket = Split & {
  /** The key a chart's category axis carries — stable, and never the label. */
  readonly key: string
  /** What a reader sees on the axis. Short: an axis tick has no room for a clause. */
  readonly label: string
  /** The whole canonical label, for the tooltip and the table view. */
  readonly title: string
  /** The series colour token for an ordinal bucket; absent on a nominal one. */
  readonly fill?: string
}

const EMPTY: Split = { total: 0, open: 0, resolved: 0, archived: 0 }

function add(split: Split, status: LifecycleState): Split {
  return {
    total: split.total + 1,
    open: split.open + (status === 'open' ? 1 : 0),
    resolved: split.resolved + (status === 'resolved' ? 1 : 0),
    archived: split.archived + (status === 'archived' ? 1 : 0),
  }
}

/** The corpus as a whole, on the one axis it actually varies along. */
export function overall(rows: readonly RecordListRow[]): Split {
  return rows.reduce((split, row) => add(split, row.lifecycle.status), EMPTY)
}

/**
 * The corpus by how bad it is, worst first.
 *
 * **A band with nothing in it still gets its bucket.** The five severities are a
 * fixed scale and a scale with a rung missing is one the reader has to count to
 * check — the shipped severity table makes the same call, and on a chart it
 * matters more: a bar chart that silently drops SEV1 is a chart that says the
 * project has no critical work, which is the opposite of true.
 */
export function bySeverity(rows: readonly RecordListRow[]): readonly Bucket[] {
  const bands = new Map<number, Split>(SEVERITIES.map((option) => [option.value, EMPTY]))
  for (const row of rows) {
    const found = bands.get(row.severity)
    if (found !== undefined) bands.set(row.severity, add(found, row.lifecycle.status))
  }

  return SEVERITIES.map((option) => ({
    key: `sev-${option.value}`,
    label: option.name,
    // The canonical label's explanatory half, its leading em dash trimmed — the
    // standing rule is that the half is never dropped, and a tooltip is the one
    // place on a chart with room to honour it (`lib/enum-labels.ts`).
    title: `${option.name}${option.rest}`,
    fill: `var(--sev-${option.value})`,
    ...(bands.get(option.value) ?? EMPTY),
  }))
}

/**
 * The corpus by the **ceiling the AI proposed** for fixing it — `proposedLevel`,
 * which has been on this row since the flat page was built and has never been
 * rendered anywhere.
 *
 * It is the one dimension that says what the remaining work *costs*, which is why
 * it earns a place beside severity: severity says how much a record hurts, level
 * says how much of the product has to move to stop it hurting, and "39 open at
 * level 2" is a different sentence from "39 open at SEV3".
 *
 * **The three cut levels are folded into one bucket, not five.** `none`,
 * `upstream` and `undecided` are the levels KC-0021 took out of what anyone may
 * choose; two records in the store still carry one, human data being
 * append-only. Five rungs plus three legacy words would be an eight-category axis
 * where three categories can only ever draw two records between them. So the
 * five rungs are the scale and the legacy values land in one honest bucket
 * outside it, which is where a reader can see them without the scale bending
 * around them.
 */
export function byLevel(rows: readonly RecordListRow[]): readonly Bucket[] {
  const rungs = new Map<number, Split>([1, 2, 3, 4, 5].map((level) => [level, EMPTY]))
  let legacy = EMPTY

  for (const row of rows) {
    const level = row.proposedLevel
    if (typeof level === 'number') {
      rungs.set(level, add(rungs.get(level) ?? EMPTY, row.lifecycle.status))
    } else {
      legacy = add(legacy, row.lifecycle.status)
    }
  }

  const scale: Bucket[] = [1, 2, 3, 4, 5].map((level) => ({
    key: `lvl-${level}`,
    label: `L${level}`,
    title: LEVEL_TITLES[level - 1] ?? `Level ${level}`,
    fill: `var(--lvl-${level})`,
    ...(rungs.get(level) ?? EMPTY),
  }))

  // Absent rather than empty: the bucket exists because two records are in it,
  // and on a store where nobody ever chose a cut level it should not draw a rung.
  if (legacy.total === 0) return scale
  return [...scale, { key: 'lvl-legacy', label: 'cut', title: 'Levels since retired', ...legacy }]
}

/**
 * The five rungs, short. `SOLUTION_LEVELS` carries the canonical two-part label
 * and its second half is a full clause — right on a radio list where a reviewer
 * is choosing, far too long for a chart tooltip, and the standing rule is that
 * the half is never *dropped* rather than that it appears everywhere. So the
 * tooltip gets the level's name and the reviewer's own list keeps the clause.
 */
const LEVEL_TITLES = [
  'Level 1 — words only',
  'Level 2 — tune existing',
  'Level 3 — add surface',
  'Level 4 — change contracts',
  'Level 5 — open-ended',
]

/**
 * The corpus by **who raised it** — the AI or the human.
 *
 * Nominal, not ordinal: neither party is further along a scale than the other, so
 * the buckets carry no fill token and the chart that draws them uses one hue for
 * both bars. Colouring two nominal bars two hues would spend the identity channel
 * re-encoding what the bar lengths already show.
 */
export function byRequester(rows: readonly RecordListRow[]): readonly Bucket[] {
  return nominal(rows, (row) => row.requester, [
    { value: 'human', label: 'Human', title: 'Raised by the human' },
    { value: 'ai', label: 'AI', title: 'Raised by the AI' },
  ])
}

/** The corpus by what kind of thing it is — a friction, or something wanted. */
export function byType(rows: readonly RecordListRow[]): readonly Bucket[] {
  return nominal(rows, (row) => row.type, [
    { value: 'issue', label: 'Issue', title: 'Issues' },
    { value: 'feature', label: 'Feature', title: 'Features' },
  ])
}

function nominal<TValue extends string>(
  rows: readonly RecordListRow[],
  of: (row: RecordListRow) => TValue,
  categories: readonly { value: TValue; label: string; title: string }[],
): readonly Bucket[] {
  const counts = new Map<TValue, Split>(categories.map((category) => [category.value, EMPTY]))
  for (const row of rows) {
    const value = of(row)
    const found = counts.get(value)
    if (found !== undefined) counts.set(value, add(found, row.lifecycle.status))
  }
  return categories.map((category) => ({
    key: category.value,
    label: category.label,
    title: category.title,
    ...(counts.get(category.value) ?? EMPTY),
  }))
}

/**
 * The axes the corpus chart can be switched between.
 *
 * **`retro` is gone by the owner's ruling** (D4, his words: *"it is useless"*).
 * It was the direction round's most striking chart — 14 columns showing the debt
 * trapped in the oldest retrospectives — and it is out anyway, because a
 * retrospective is not a dimension a reader acts on: knowing which round filed a
 * record does not tell you anything you can do about it, and the diary at the
 * foot of the page already says which round filed what. The finding it drew was
 * worth having once; a permanent control is a different bar.
 */
export const DIMENSIONS = ['severity', 'level', 'requester', 'type'] as const
export type Dimension = (typeof DIMENSIONS)[number]

/** What each switch position is called, and what it claims. */
export const DIMENSION_META: Readonly<
  Record<Dimension, { readonly label: string; readonly claim: string; readonly ordinal: boolean }>
> = {
  severity: { label: 'Severity', claim: 'How much it hurts', ordinal: true },
  level: { label: 'Solution level', claim: 'How much has to move to fix it', ordinal: true },
  requester: { label: 'Requester', claim: 'Who noticed', ordinal: false },
  type: { label: 'Type', claim: 'Friction, or something wanted', ordinal: false },
}

export function bucketsFor(
  dimension: Dimension,
  rows: readonly RecordListRow[],
): readonly Bucket[] {
  switch (dimension) {
    case 'severity':
      return bySeverity(rows)
    case 'level':
      return byLevel(rows)
    case 'requester':
      return byRequester(rows)
    case 'type':
      return byType(rows)
  }
}

/**
 * The share of the corpus that is no longer open, as a percentage — the one
 * number a dashboard can lead with.
 *
 * Rounded, and `0` on an empty store rather than `NaN`: a fresh install has
 * closed none of nothing, and a hero figure reading "NaN%" is the worst thing a
 * dashboard can say.
 */
export function closedShare(split: Split): number {
  if (split.total === 0) return 0
  return Math.round(((split.resolved + split.archived) / split.total) * 100)
}

/** The lifecycle positions, in the order every stack on this page draws them. */
export const STACK_ORDER: readonly LifecycleState[] = LIFECYCLE_STATES

/**
 * **High severity, still open** — SEV1 and SEV2 together, on the lifecycle axis
 * rather than the verdict one.
 *
 * The two bands are counted as one number because that is the reading: SEV1 is
 * *halts everything* and SEV2 is *blocks a major flow*, and a reader asking "is
 * anything on fire" wants their sum, not a choice between them. Splitting them
 * into two tiles would spend two of four columns on a distinction the reader
 * makes after they have decided to look.
 *
 * Measured on the owner's store the day this shipped: 18 — two SEV1 and sixteen
 * SEV2, none of the SEV1s resolved. That is a number worth a tile; a tile that
 * could only ever read zero would not be.
 */
export function highSeverityOpen(rows: readonly RecordListRow[]): number {
  return rows.filter((row) => row.lifecycle.status === 'open' && row.severity <= 2).length
}

/**
 * **"Require human"** — the open records that need him, split by which kind of
 * needing it is.
 *
 * The owner ruled this one after the tradeoffs were put to him (D6, his words:
 * *"just check if something is open and the human had involvement option is
 * interactive or whatever it is named"*). What he was told before he chose:
 *
 * - `involvement` was **not on this row**, so counting it meant widening the
 *   wire — core read model, wire schema and the typed mock, done whole in this
 *   lane per `r-wire-widening-two-package`. It is done.
 * - Two of the five values cannot be read as needs-the-human — `other` is *"the
 *   note says what"* and `undecided` is the field's **default**, so a broader
 *   predicate would have merged "needs him" with "nobody has said".
 * - The tile reads **3** on his store, because 149 of 154 records are
 *   `autonomous`. He accepted that as the honest number rather than widening the
 *   predicate to make the tile look busier.
 *
 * **Two counts, not one merged number** (D7, his words: *"another number in it
 * that covers open issues that require pull-requests"*). D6 had named
 * `interactive` alone; he then added `pull-request` beside it rather than inside
 * it, which is the better shape and for the reason the merge would have been
 * wrong: the two describe genuinely different demands on him. `interactive` means
 * he works the fix live — his whole attention, scheduled. `pull-request` means he
 * reads a diff after the fact. A single total would have said "N things need you"
 * while hiding which kind of need, and those two kinds are not substitutable.
 *
 * The other three values stay out, and `undecided` is the one worth naming: it is
 * the field's default, so counting it would have swept in every record nobody has
 * ruled on and reported "nobody has decided" as "needs you".
 *
 * **`pullRequest` reads 0 on his store and that is rendered, not hidden** — his
 * explicit instruction. It is the one place on this page where a zero is drawn
 * rather than suppressed: the page's standing rule is that the honest rendering of
 * nothing is nothing, and he overrode it here because the *pair* is the reading.
 * "3 · 0" says the queue is all live-session work and none of it is diff review,
 * which is a fact about how he will spend the week; "3" alone says only the first
 * half of it.
 */
export type HumanInTheLoop = {
  /** Open, and the human works the fix live. */
  readonly interactive: number
  /** Open, and the human reviews before merge. */
  readonly pullRequest: number
}

/**
 * **The membership test, exported so the tile and the table share one predicate.**
 *
 * D9 gave the readings table a "Require human" tab listing the records the third
 * tile counts. Two places asking the same question is two places to get it wrong —
 * and the failure would be quiet, because a tab whose rows disagreed with the
 * number above it still renders perfectly. So there is one predicate: the tile
 * splits what this returns by value, and the tab lists it.
 */
export function needsHuman(row: RecordListRow): boolean {
  return (
    row.lifecycle.status === 'open' &&
    (row.involvement === 'interactive' || row.involvement === 'pull-request')
  )
}

export function requireHumanInTheLoop(rows: readonly RecordListRow[]): HumanInTheLoop {
  const needing = rows.filter(needsHuman)
  return {
    interactive: needing.filter((row) => row.involvement === 'interactive').length,
    pullRequest: needing.filter((row) => row.involvement === 'pull-request').length,
  }
}
