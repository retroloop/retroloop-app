import { useState } from 'react'
import { LifecycleStack } from '@/components/dashboard/charts'
import {
  bucketsFor,
  DIMENSION_META,
  DIMENSIONS,
  type Dimension,
} from '@/components/dashboard/corpus-stats'
import { Panel, Surface } from '@/components/dashboard/pieces'
import type { RecordListRow } from '@/components/records/record-lifecycle'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

/**
 * **The corpus, by any axis** — the dashboard's one chart, and the one control
 * that survived the cut.
 *
 * `shadcn-dashboard-01.png` puts a **date range** in this corner — *Last 3 months
 * / Last 30 days / Last 7 days* — and that is the one thing this data cannot
 * fill: the store is five days old across ten irregular sittings, so three
 * presets would show the same records three times. The switch changes the
 * **dimension** instead, which is the substitution that made this the variation
 * chosen: four axes the corpus genuinely varies along, one chart, and the
 * reader chooses the question.
 *
 * **The colour language stays put while the axis moves.** Every position draws
 * the same three lifecycle series — still open, resolved, archived — so the reader
 * learns one key and then changes the subject under it. Colouring by the dimension
 * instead would put four colour languages behind one control, and the switch would
 * stop being a switch and become four charts.
 *
 * **`Retrospective` is gone**, as a dimension nobody can act on. The reasoning
 * is at `DIMENSIONS` in `corpus-stats.ts`.
 *
 * **Every tab draws horizontally**: Requester and Type use the same style as
 * Severity and Solution level.
 *
 * An earlier design had it split — ordinal axes horizontal, nominal axes as
 * vertical columns — on the argument that a rung's name carries a clause a tick
 * cannot hold sideways while "AI" and "human" fit either way. The split was the
 * wrong call, and the reason is one that design missed: the orientation was
 * doing *no work for the reader* and a lot of work against them.
 * Four tabs behind one control are meant to be the same chart with the subject
 * changed; two of them re-laying-out on press made the control feel like it was
 * navigating between different charts rather than re-asking one question. One
 * orientation is what makes it read as one chart.
 *
 * So the stack draws every axis and the one-hue nominal bars are gone with the
 * split — `NominalBars` had exactly this caller and is deleted rather than left
 * compiling for nobody. What survives of its argument is the colour rule, which
 * was never about orientation: a nominal axis still must not be coloured by
 * identity, and it is not, because every tab is coloured by lifecycle.
 */
export function CorpusAxis({ rows }: { rows: readonly RecordListRow[] }) {
  const [dimension, setDimension] = useState<Dimension>('severity')
  const meta = DIMENSION_META[dimension]
  const buckets = bucketsFor(dimension, rows)

  return (
    <Panel
      testId="corpus-axis"
      title="The corpus, by any axis"
      claim={meta.claim}
      action={
        <Tabs value={dimension} onValueChange={(next) => setDimension(next as Dimension)}>
          <TabsList data-testid="dimension-switch">
            {DIMENSIONS.map((option) => (
              <TabsTrigger key={option} value={option} data-testid={`dimension-${option}`}>
                {DIMENSION_META[option].label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      }
    >
      <Surface>
        <LifecycleStack
          buckets={buckets}
          orientation="horizontal"
          className="h-[248px]"
          title={`Records by ${meta.label.toLowerCase()}, split by lifecycle`}
        />
      </Surface>
    </Panel>
  )
}
