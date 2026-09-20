import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { needsHuman } from '@/components/dashboard/corpus-stats'
import { Panel, Surface } from '@/components/dashboard/pieces'
import { LifecycleTag, type RecordListRow } from '@/components/records/record-lifecycle'
import { optionFor, SEVERITIES } from '@/lib/enum-labels'
import { cn } from '@/lib/utils'

/**
 * **The rows behind the readings** — `shadcn-dashboard-01.png`'s bottom third, and
 * the part of the Control Room that made it an instrument panel rather than a
 * poster: every number above this can be opened.
 *
 * **Not a data grid.** The reference puts a fully sortable,
 * selectable, column-configurable table in this slot, and every one of those
 * affordances already exists one page over on `/records`. A second copy here would
 * be the dashboard becoming the records page in miniature — which is the failure
 * the page has to avoid or it has no reason to exist beside it. So it is ten ruled
 * rows that link out, four tabs that are questions rather than filters, and a
 * line saying where the real table is.
 */

type Tab = 'open' | 'human' | 'severe' | 'closed'

/**
 * The four cuts worth a tab, in the order their tiles read across the row above.
 *
 * Each is a question the numbers above raise and the reader will want the rows
 * for: *what is still owed*, *what needs the human personally*, *what is worst and
 * still owed*, *what actually got done*. Three of them now answer to a tile by the
 * same name, which is what the table and the boxes are meant to be — one system
 * rather than two vocabularies over one corpus.
 *
 * The count rides in brackets, the standing rule for every counted item —
 * "Labels (1)" instead of "Labels 1".
 */
const TABS: readonly {
  key: Tab
  label: string
  pick: (rows: readonly RecordListRow[]) => readonly RecordListRow[]
}[] = [
  {
    key: 'open',
    label: 'Still open',
    pick: (rows) => rows.filter((row) => row.lifecycle.status === 'open'),
  },
  /**
   * The Require Human tab exists so that the rows behind the readings match the
   * tabs above. It lists exactly what the third stat tile counts — through
   * `needsHuman`, the tile's own predicate, so the rows here and the numbers up
   * there cannot come to disagree.
   *
   * It sits **second**, where its tile sits third in a row whose first tile
   * (Records) has no cut of its own. Reading down the page the two now line up:
   * Still open → Require human → High sev, with Closed after them as the one cut
   * that answers to no tile.
   */
  {
    key: 'human',
    label: 'Require human',
    pick: (rows) => rows.filter(needsHuman),
  },
  /**
   * **Renamed from "Severe and open" to match its tile.** It is the identical set
   * — open, SEV1 or SEV2 — and it was carrying a second name for it. Two names for
   * one reading is the thing this page argues against everywhere else, and the
   * table and the boxes are meant to read as one system.
   */
  {
    key: 'severe',
    label: 'High sev',
    pick: (rows) => rows.filter((row) => row.lifecycle.status === 'open' && row.severity <= 2),
  },
  {
    key: 'closed',
    label: 'Closed',
    pick: (rows) => rows.filter((row) => row.lifecycle.status !== 'open'),
  },
]

/** How many rows a tab shows before the reader should be on `/records` instead. */
const SHOWN = 10

export function Readings({ rows }: { rows: readonly RecordListRow[] }) {
  const [tab, setTab] = useState<Tab>('open')
  const chosen = TABS.find((option) => option.key === tab) ?? TABS[0]
  const picked = chosen?.pick(rows) ?? []

  return (
    <Panel
      testId="readings"
      title="The rows behind the readings"
      claim={`Ten at a time. The whole corpus, filtered and sortable, is the records page.`}
      action={
        <div
          data-testid="readings-tabs"
          className="flex flex-wrap gap-1 rounded-lg bg-surface p-1"
          role="tablist"
        >
          {TABS.map((option) => (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={tab === option.key}
              data-testid={`readings-tab-${option.key}`}
              onClick={() => setTab(option.key)}
              className={cn(
                'rounded-md px-2.5 py-1 font-medium text-xs transition-colors',
                tab === option.key
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option.label} ({option.pick(rows).length})
            </button>
          ))}
        </div>
      }
    >
      {picked.length === 0 ? (
        <Surface>
          <p data-testid="readings-empty" className="text-muted-foreground text-sm">
            Nothing in this cut of the corpus.
          </p>
        </Surface>
      ) : (
        <div
          data-testid="readings-table"
          className="overflow-hidden rounded-xl border border-hairline bg-card"
        >
          <ul className="flex flex-col">
            {picked.slice(0, SHOWN).map((row) => (
              <li
                key={`${row.retroId}-${row.rid}`}
                className="border-hairline border-t first:border-t-0"
              >
                <ReadingRow row={row} />
              </li>
            ))}
          </ul>
          {/* Only when there is more than the page shows. "10 of 10" would be a
              line the reader reads to learn nothing. */}
          {picked.length > SHOWN ? (
            <div className="border-hairline border-t px-4 py-2.5">
              <Link
                to="/records"
                search={row_search(tab)}
                data-testid="readings-more"
                className="text-muted-foreground text-xs hover:text-primary"
              >
                {picked.length - SHOWN} more on the records page →
              </Link>
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  )
}

/**
 * The filter the "more" link carries, so the reader lands on the rows the tab was
 * counting rather than on an unfiltered page they have to narrow by hand.
 *
 * `severe` has no search of its own: `/records` narrows by lifecycle, not by
 * severity, so the honest link is the open cut — the severe rows are inside it,
 * and offering `?severity=` would be inventing a parameter that page does not
 * police (`r-validatesearch-narrows-not-polices`).
 */
function row_search(tab: Tab): { lifecycle?: 'open' | 'resolved' | 'archived' } {
  if (tab === 'closed') return { lifecycle: 'resolved' }
  // `human` and `severe` land on the open cut too: `/records` narrows by
  // lifecycle and by nothing else this page could use, so their rows are inside
  // it. Offering `?involvement=` or `?severity=` would be inventing parameters
  // that page does not police (`r-validatesearch-narrows-not-polices`).
  return { lifecycle: 'open' }
}

function ReadingRow({ row }: { row: RecordListRow }) {
  return (
    <Link
      to="/records/$recordId"
      params={{ recordId: String(row.globalId) }}
      data-testid={`readings-row-${row.globalId}`}
      className="group flex flex-col gap-1.5 px-4 py-3 transition-colors hover:bg-surface-raised sm:flex-row sm:items-center sm:gap-4"
    >
      <span className="meta-mono shrink-0 tabular-nums sm:w-10">#{row.globalId}</span>
      <span className="min-w-0 flex-1 truncate text-sm group-hover:text-primary">{row.title}</span>
      {/**
       * `Retro {retroId} · session {id}` rather than the shared identity line.
       * That line prints `Retro #n`, the per-session number a list must not
       * use, and the working directory — which on this store is the same string
       * on all 154 rows and had to be truncated to fit. A column that says the
       * same thing on every row, illegibly, has earned nothing.
       */}
      <span className="meta-mono hidden shrink-0 lg:block">
        Retro {row.retroId} · session {row.session.id}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <SeverityMark severity={row.severity} />
        <LifecycleTag status={row.lifecycle.status} />
      </span>
    </Link>
  )
}

/**
 * A record's severity as the ordinal ramp's own swatch plus the word.
 *
 * The colour is the same step the severity chart uses, which is what makes a row
 * recognisable as belonging to a band the reader just looked at. The word is there
 * because a swatch alone would be state carried by colour, which this app never
 * does (`ui/tag.tsx`).
 */
function SeverityMark({ severity }: { severity: RecordListRow['severity'] }) {
  const option = optionFor(SEVERITIES, severity)
  return (
    <span
      data-testid="readings-severity"
      className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2 py-0.5 font-semibold text-[0.625rem] uppercase tracking-[0.08em]"
    >
      <span
        aria-hidden
        className="size-1.5 rounded-full"
        style={{ background: `var(--sev-${severity})` }}
      />
      {option?.name ?? `SEV${severity}`}
    </span>
  )
}
