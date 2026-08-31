import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { type Bucket, STACK_ORDER } from '@/components/dashboard/corpus-stats'
import { LIFECYCLE_TAG, type LifecycleState } from '@/components/records/record-lifecycle'
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { cn } from '@/lib/utils'

/**
 * **The one chart form the dashboard draws, and no others.**
 *
 * The direction round carried six — a cumulative filed-against-resolved pair, a
 * donut of what the open queue costs, a radar of which severity band is being
 * neglected, and a proportion meter besides. The owner's ruling kept the stack
 * and the nominal bars and removed the rest: *"What The Open Queue Costs"* and
 * *"Which End Is Being Neglected"* by name, and the other three with the
 * variations that housed them. They are deleted rather than left behind a flag —
 * an unreachable chart is code that has to keep compiling for nobody.
 *
 * What survives is the one form the one surviving chart panel needs: a **stack**,
 * for "how much of this bucket is still owed". The one-hue nominal bars went too,
 * when the owner ruled that every tab draws horizontally (D6) — that ruling left
 * them with no caller, and the orientation split was their only reason to exist.
 * The stack keeps both orientations because `vertical` is still the right reading
 * for a sequence, and a component that supports one orientation today is one
 * rewrite away from supporting the other.
 *
 * **Two colour jobs and no third.** Lifecycle is a *status* scale — reserved
 * meaning, the app's own three tones, always with a legend and the word beside it
 * — and severity and solution level are *ordinal* scales, one hue each, five
 * monotone steps. Nothing on this page is coloured by identity, which is why
 * there is no categorical palette anywhere in it: the two nominal dimensions
 * (requester, type) draw their bars in one hue, because colouring two nominal
 * bars two colours spends the identity channel re-encoding what the bar lengths
 * already show. The tokens and the validation evidence are in `styles.css`.
 */

/** The lifecycle series, named for the legend and coloured from the status scale. */
export const LIFECYCLE_CHART: ChartConfig = {
  open: { label: 'Still open', color: 'var(--series-open)' },
  resolved: { label: 'Resolved', color: 'var(--series-resolved)' },
  archived: { label: 'Archived', color: 'var(--series-archived)' },
}

/** Recessive, hairline, solid — never dashed. One step off the surface. */
const GRID = { stroke: 'var(--hairline)', strokeWidth: 1 } as const
/** <= 24px, so the band's leftover is air rather than ink. */
const BAR_CAP = 22
/** The surface gap that separates touching segments. Two pixels, everywhere. */
const GAP = 2

type SegmentProps = {
  x?: number
  y?: number
  width?: number
  height?: number
  fill?: string
  /** Recharts hands the whole datum through, which is how a segment knows its neighbours. */
  payload?: Record<string, unknown>
  dataKey?: string
}

/**
 * One segment of a stacked bar — **the surface gap and the rounded data-end, drawn
 * rather than approximated.**
 *
 * Recharts stacks its rectangles edge to edge and has no notion of a gap between
 * them, and the two ways round that without a custom shape are both wrong. A
 * stroke in the surface colour is a border, and a border adds ink that is not
 * data — it also paints the stack's *outer* edge, which makes every bar look
 * outlined. Padding the data is worse: it changes the numbers to fix a drawing.
 *
 * So the segment insets itself. It gives up `GAP` pixels on the side that faces
 * the next segment along, keeps its baseline edge square, and rounds only the
 * outer data-end — and only when it *is* the outer end, which it works out from
 * the datum it was handed rather than from its position in the stack: on a
 * severity band with nothing resolved, `open` is the top of the stack and takes
 * the rounding, and on the band below it `resolved` does.
 *
 * A segment thinner than the gap it would give up is drawn at its full height. A
 * one-record segment on a 154-record scale is about a pixel tall, and insetting
 * it would round it away to nothing — which would say the bucket is empty when it
 * is not.
 */
function StackSegment({ orientation }: { orientation: 'vertical' | 'horizontal' }) {
  return function Segment(props: SegmentProps) {
    const { x = 0, y = 0, width = 0, height = 0, fill, payload, dataKey } = props
    if (width <= 0 || height <= 0) return null

    const outermost = topOfStack(payload)
    const isOuter = outermost === dataKey
    // A segment with something beyond it gives up the gap on that side; the
    // outer one has nothing to be separated from and keeps its full extent.
    const shrink = isOuter ? 0 : GAP

    if (orientation === 'vertical') {
      // Columns grow up from the baseline: the gap comes off the top, and the
      // rounding goes on the cap.
      const h = height > shrink + 1 ? height - shrink : height
      const top = y + (height - h)
      const r = isOuter ? Math.min(4, h, width / 2) : 0
      return <path d={roundedTop(x, top, width, h, r)} fill={fill} />
    }

    // Bars grow right from the baseline: the gap comes off the right edge.
    const w = width > shrink + 1 ? width - shrink : width
    const r = isOuter ? Math.min(4, w, height / 2) : 0
    return <path d={roundedRight(x, y, w, height, r)} fill={fill} />
  }
}

/**
 * Which of the lifecycle series is the outer end of this datum's stack — the last
 * one in draw order that has anything in it.
 *
 * `STACK_ORDER` is the order the bars are declared in, so scanning it backwards
 * finds the segment furthest from the baseline. A datum with nothing in it at all
 * has no outer end, and nothing is drawn for it anyway.
 */
function topOfStack(payload: Record<string, unknown> | undefined): string | undefined {
  if (payload === undefined) return undefined
  for (let index = STACK_ORDER.length - 1; index >= 0; index -= 1) {
    const key = STACK_ORDER[index]
    if (key !== undefined && Number(payload[key] ?? 0) > 0) return key
  }
  return undefined
}

/** Square at the baseline, `r`-rounded at the cap. */
function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  if (r <= 0) return `M${x},${y}h${w}v${h}h${-w}Z`
  return `M${x},${y + r}a${r},${r} 0 0 1 ${r},${-r}h${w - 2 * r}a${r},${r} 0 0 1 ${r},${r}v${h - r}h${-w}Z`
}

/** Square at the baseline, `r`-rounded at the right-hand data-end. */
function roundedRight(x: number, y: number, w: number, h: number, r: number): string {
  if (r <= 0) return `M${x},${y}h${w}v${h}h${-w}Z`
  return `M${x},${y}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${h - 2 * r}a${r},${r} 0 0 1 ${-r},${r}h${-(w - r)}Z`
}

/** The shape of a datum the lifecycle stacks read. */
type StackDatum = Record<LifecycleState, number> & {
  key: string
  label: string
  title: string
}

function toStackData(buckets: readonly Bucket[]): StackDatum[] {
  return buckets.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    title: bucket.title,
    open: bucket.open,
    resolved: bucket.resolved,
    archived: bucket.archived,
  }))
}

/**
 * **How much of each bucket is still owed** — the workhorse of all three
 * variations, in the two orientations a dashboard needs.
 *
 * Horizontal when the categories carry words a tick cannot hold sideways (the
 * five severities, each with a clause behind its name); vertical when the
 * categories are a sequence the reader should see running left to right (the
 * retrospectives, the sittings). The choice is about the labels and the reading
 * direction, never about variety.
 *
 * `open` is declared first, so it sits **at the baseline** in both orientations.
 * That is the emphasis decision of this whole page: the open count is what the
 * dashboard is for, a segment anchored to the axis is the one the eye measures
 * first, and the alternative — resolved at the baseline — would draw the good
 * news as the solid foundation and the debt as something floating on top of it.
 */
export function LifecycleStack({
  buckets,
  orientation,
  className,
  title,
}: {
  buckets: readonly Bucket[]
  orientation: 'vertical' | 'horizontal'
  className?: string
  /** Named on the container for a screen reader; the visible heading is the caller's. */
  title: string
}) {
  const data = toStackData(buckets)
  const Segment = StackSegment({ orientation })
  const drawn = STACK_ORDER.filter((status) => data.some((datum) => datum[status] > 0))

  return (
    /**
     * `data-orientation` is published on the wrapper so the suite can assert
     * *which way the chart is drawn* without measuring pixels. The owner's D6
     * ruling is about orientation, and the honest way to check a ruling about
     * orientation is a probe the renderer states — not a comparison of tick
     * coordinates, which is a position assertion the browser does half of for
     * free and which would go green for the wrong reason the day recharts changes
     * its layout maths.
     */
    <div
      data-testid="lifecycle-stack"
      data-orientation={orientation}
      className="flex min-w-0 flex-col gap-3"
    >
      <ChartContainer config={LIFECYCLE_CHART} className={cn('aspect-auto w-full', className)}>
        <BarChart
          accessibilityLayer
          data={data}
          layout={orientation === 'horizontal' ? 'vertical' : 'horizontal'}
          margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
          aria-label={title}
        >
          <CartesianGrid
            {...GRID}
            horizontal={orientation === 'vertical'}
            vertical={orientation === 'horizontal'}
          />
          {orientation === 'horizontal' ? (
            <>
              {/**
               * **64px, sized off the longest tick this chart can hold.**
               *
               * It was 44 while only the ordinal axes drew horizontally — `SEV1`
               * and `L1` fit that comfortably. D6 flipped Requester and Type into
               * the same orientation, which brought `Feature` into a gutter built
               * for four characters, and the axis cropped it to `eature`: text
               * clipped by its own mark, which is the one thing a label must
               * never be.
               *
               * Caught by looking at a screenshot, and it could not have been
               * caught otherwise — clipping is visual, and the SVG text node
               * still reads `Feature` either way. That is the whole argument for
               * rendering a chart and looking at it before calling it done.
               */}
              <YAxis
                type="category"
                dataKey="label"
                tickLine={false}
                axisLine={false}
                width={64}
                tickMargin={4}
              />
              <XAxis type="number" tickLine={false} axisLine={false} tickMargin={6} />
            </>
          ) : (
            <>
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={6}
                interval={0}
              />
              <YAxis tickLine={false} axisLine={false} width={30} tickMargin={4} />
            </>
          )}
          <ChartTooltip
            cursor={false}
            content={<ChartTooltipContent labelKey="title" indicator="dot" />}
          />
          {STACK_ORDER.map((status) => (
            <Bar
              key={status}
              dataKey={status}
              stackId="lifecycle"
              fill={`var(--color-${status})`}
              maxBarSize={BAR_CAP}
              shape={Segment}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ChartContainer>
      {/**
       * The legend is **HTML under the chart, not recharts' own**, and the reason
       * is order. Recharts builds its legend payload from the order it registered
       * the series in internally, which came out alphabetical — "Archived · Still
       * open · Resolved" — against a stack that draws open, resolved, archived from
       * the baseline up. A legend whose order contradicts the stack it explains is
       * worse than no legend, because the reader trusts it.
       *
       * Rendering it here fixes that and buys two more things: it is the same key
       * the hero and the meter already use (`SeriesKey`), so lifecycle has one
       * appearance across the whole page however it is drawn; and it can drop a
       * position nothing in *this* chart holds, which recharts' cannot.
       */}
      <SeriesKey statuses={drawn} />
    </div>
  )
}

/**
 * The lifecycle key: a dot, the word, in the order the stacks draw.
 *
 * Text wears text tokens and the dot carries the identity — never a coloured
 * word, which is the app's standing rule for state (`ui/tag.tsx`) and the
 * charting rule for labels as well.
 */
function SeriesKey({ statuses }: { statuses: readonly LifecycleState[] }) {
  if (statuses.length < 2) return null
  return (
    <ul data-testid="series-key" className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-1">
      {statuses.map((status) => (
        <li key={status} className="flex items-center gap-1.5 text-muted-foreground text-xs">
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{ background: `var(--series-${status})` }}
          />
          {status === 'open' ? 'still open' : LIFECYCLE_TAG[status].label}
        </li>
      ))}
    </ul>
  )
}
