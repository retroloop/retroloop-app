import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo } from 'react'
import { AppShell } from '@/components/chrome/app-shell'
import { CorpusAxis } from '@/components/dashboard/corpus-axis'
import {
  closedShare,
  highSeverityOpen,
  overall,
  requireHumanInTheLoop,
} from '@/components/dashboard/corpus-stats'
import { SessionLedger } from '@/components/dashboard/diary'
import { LiveBand } from '@/components/dashboard/live-band'
import { Panel, StatRow, StatTile } from '@/components/dashboard/pieces'
import { Readings } from '@/components/dashboard/readings'
import { APP_NAME } from '@/lib/app-name'
import { useTRPC } from '@/lib/trpc'

export const Route = createFileRoute('/')({ component: Dashboard })

/**
 * **The composed dashboard.**
 *
 * Several compositions were tried, with charts chosen against real data
 * rather than against fixtures; this is the one that shipped: primarily
 * "The Control Room", with two pieces borrowed from the alternatives and
 * two of the Control Room's own blocks removed.
 *
 * **The order, top to bottom:**
 *
 * 1. **The menu**, which is now the shell's own and holds nothing of this page's:
 *    the two loose links this route used to hang in the header — Records and
 *    Settings — collapsed into the one dropdown every page carries
 *    (`chrome/app-menu.tsx`), so the dashboard renders no navigation at all.
 * 2. **The live band** — the Debt Front's RETRO IN FLIGHT row. Conditional: it
 *    renders nothing when no retrospective is open, and one entry per round when
 *    several are.
 * 3. **Four stat tiles** — Records, Still open, Require human (third, and
 *    carrying two counts: interactive and pull-request), High Sev.
 * 4. **The corpus by any axis** — the Control Room's switchable chart, with the
 *    Retrospective tab dropped.
 * 5. **The readings table** — the rows behind the numbers.
 * 6. **The diary** — the Work Diary's session cards, with relative
 *    dates and global retro ids.
 *
 * **Removed, entirely:** "What The Open Queue Costs" (the
 * solution-level donut) and "Which End Is Being Neglected" (the severity radar).
 * Deleted, not hidden — an unreachable chart is code that keeps compiling for
 * nobody.
 *
 * **What this replaced.** The previous dashboard led with a records block whose
 * own docstrings argued from "132 records" and "twelve retrospectives" —
 * a count that went stale within a week. Those
 * numbers are gone with the block, and nothing here restates a count in prose: a
 * figure that lives in a comment is a figure that goes stale silently, and this
 * page is now read by four components that all count the same rows through
 * `corpus-stats.ts`.
 *
 * **It must still stay calmer than `/records`, or it has no reason to exist.**
 * That page enumerates the corpus — every row, four filters, a reader scanning.
 * This one measures it and offers ten rows as a way in. The table here is
 * deliberately not a data grid; the reasoning is at `readings.tsx`.
 */
function Dashboard() {
  const trpc = useTRPC()

  /**
   * `{}` and not nothing on both: `retros.list` and `records.listAll` each take
   * `z.strictObject({})`, so an omitted input is a missing one rather than an
   * empty one and the server rejects it.
   *
   * **Two queries and no new wire.** Every figure on this page is a pass over rows
   * the product already serves. A per-retro or per-session count on the server
   * would be a wire widening — a two-package change, `r-wire-widening-two-package`
   * — and nothing here needs one: the diary places a retrospective by its
   * session's `startedAt`, which `retros.list` has carried since the schema
   * existed and which nothing rendered before now.
   */
  const retros = useQuery(trpc.retros.list.queryOptions({}))
  const records = useQuery(trpc.records.listAll.queryOptions({}))

  const split = useMemo(() => overall(records.data ?? []), [records.data])
  const humanInTheLoop = useMemo(() => requireHumanInTheLoop(records.data ?? []), [records.data])

  // Both, because the page is one reading of two answers and a half-drawn
  // dashboard that grows a chart a moment later is worse than a blank one.
  if (retros.data === undefined || records.data === undefined) return null

  return (
    <AppShell crumbs={[{ label: APP_NAME }]}>
      {retros.data.length === 0 ? (
        /**
         * Only ever true on a fresh install: a retrospective is what this product
         * makes, and nothing deletes one. So it says the one true thing and stops
         * — an onboarding panel here is a panel seen once and every
         * later reader never sees at all.
         *
         * Keyed on the retrospectives and not on the corpus, because a store can
         * hold a retrospective whose every record has been archived, and that is
         * not a fresh install.
         */
        <p className="text-muted-foreground text-sm" data-testid="dashboard-empty">
          No retrospectives yet. The first one lands here when the AI files a revision.
        </p>
      ) : (
        <div className="flex min-w-0 flex-col gap-9">
          <LiveBand retros={retros.data} />

          <StatRow testId="dashboard-stats">
            <StatTile
              testId="stat-records"
              label="Records"
              value={split.total}
              note={`${retros.data.length} retros`}
              support="Everything the project has written down about itself."
            />
            <StatTile
              testId="stat-open"
              tone="lead"
              label="Still open"
              value={split.open}
              note={`${100 - closedShare(split)}%`}
              support="Press to open these rows on the records page."
              opens="open"
            />
            {/**
             * Counts open records whose involvement is `interactive`. The wire
             * widening this needed weighed real tradeoffs — the whole account
             * is on `requireHumanInTheLoop`.
             */}
            <StatTile
              testId="stat-requires-human"
              label="Require human"
              pair={[
                { label: 'interactive', value: humanInTheLoop.interactive },
                { label: 'pull request', value: humanInTheLoop.pullRequest },
              ]}
              support="Open records that need you in the fix, or need you to read the diff."
            />
            <StatTile
              testId="stat-high-sev"
              label="High sev"
              value={highSeverityOpen(records.data)}
              note="SEV1 + SEV2"
              support="Open, and at the two severities that halt or block the work."
            />
          </StatRow>

          <CorpusAxis rows={records.data} />

          <Readings rows={records.data} />

          <Panel
            testId="diary"
            title="The diary"
            claim="Sittings newest first; inside a sitting, the retrospectives in the order they happened."
          >
            <SessionLedger retros={retros.data} density="full" />
          </Panel>
        </div>
      )}
    </AppShell>
  )
}
