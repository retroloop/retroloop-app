import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { AppShell } from '@/components/chrome/app-shell'
import { LIFECYCLE_STATES, type LifecycleState } from '@/components/records/record-lifecycle'
import {
  EmptiedRecords,
  RecordsFilterBar,
  useRecordsFilter,
} from '@/components/records/records-filter'
import { RecordsRow } from '@/components/records/records-row'
import { APP_NAME } from '@/lib/app-name'
import { useTRPC } from '@/lib/trpc'

/**
 * Where the reader arrived from, when they arrived from a number.
 *
 * One optional key, narrowed the way `/retros/$retroId` narrows its three:
 * hand-rolled, no schema library, and anything unrecognised is left out of what
 * this function returns — a URL naming a lifecycle state that does not exist is
 * a URL with no filter in it, not an error page.
 *
 * **What this does NOT do is stop the junk reaching the page.** It was measured
 * on this very route: the validator runs, returns `{}` for
 * `?lifecycle=nonsense`, and `Route.useSearch()` answers `nonsense` anyway —
 * `validateSearch` narrows the TYPE and does not police the VALUE. What this
 * function is, is the *type*; the guard the page depends on is at the point of
 * use, in `useRecordsFilter` (`records-filter.tsx` §seeded), where nothing the
 * router decides to keep can get around it.
 */
type RecordsSearch = {
  readonly lifecycle?: LifecycleState
}

export const Route = createFileRoute('/records')({
  validateSearch: (search: Record<string, unknown>): RecordsSearch =>
    LIFECYCLE_STATES.some((status) => status === search.lifecycle)
      ? { lifecycle: search.lifecycle as LifecycleState }
      : {},
  component: RecordsPage,
})

/**
 * Every record of every retrospective, flat — a page that shows all the retro
 * items flat with filtering, so every item shows irrespective of the session or
 * retro or cwd it happened in, all in one place, narrowed down with filters.
 *
 * Newest first, which is the order `records.listAll` sends and this page does
 * not second-guess: retro id descending, and each retrospective's records in the
 * order the reviewer read them. Sorting here would be a second opinion about an
 * order the server already has a reason for.
 *
 * **Filtering is the client's.** The procedure takes no arguments at all — the
 * whole store is hundreds of records for one user, so the browser holds every
 * row and the three chips narrow it without another round trip, and no decision
 * has been made yet about which filters deserve to be on the wire.
 *
 * **Nothing lives here that the review page already answers.** No per-record
 * detail, no search, no labels or tags, no export, no bulk actions — the
 * deferred list, which stays deferred until a retro brings one back.
 */
function RecordsPage() {
  const trpc = useTRPC()
  /**
   * `{}` and not nothing: `records.listAll` takes `z.strictObject({})`, so an
   * omitted input is a missing one rather than an empty one and the server
   * rejects it — the same call the dashboard makes to `retros.list`.
   *
   * **`refetchOnWindowFocus` is turned back on for this one query**, against
   * the app-wide default. Every other page in this app is scoped to a single
   * retrospective and keeps itself current from that retrospective's event
   * stream; this page is scoped to all of them, `events.onRetro` is per-retro,
   * and a flat cross-retro page therefore has nothing single to subscribe to
   * (and the standing rule is that no cross-retro scope gets invented for v1).
   * So the two signals it does have are the ones it uses: it invalidates after
   * its own writes, and it asks again when the reader comes back to the tab —
   * which is exactly when the AI, working in its own process, has been
   * resolving the records the reader left open.
   */
  const records = useQuery({
    ...trpc.records.listAll.queryOptions({}),
    refetchOnWindowFocus: true,
  })
  const { lifecycle } = Route.useSearch()
  const filter = useRecordsFilter(records.data, lifecycle)

  return (
    <AppShell crumbs={[{ label: APP_NAME, to: '/' }, { label: 'Records' }]}>
      {records.data === undefined ? null : records.data.length === 0 ? (
        /**
         * No records anywhere, which on a store that has ever held a
         * retrospective is only true of a fresh install. It says the one true
         * thing and stops, exactly as the empty dashboard does — and it is not
         * the emptied-filter message, because emptiness the filters did not
         * cause is not emptiness they can explain.
         */
        <p className="text-muted-foreground text-sm" data-testid="records-empty">
          No records yet. They land here as the AI files retrospectives.
        </p>
      ) : (
        // `min-w-0` so a long reference or a long working directory narrows the
        // column rather than widening the page (nothing scrolls sideways).
        <div className="flex min-w-0 flex-col gap-4">
          <RecordsFilterBar filter={filter} />
          <EmptiedRecords filter={filter} />

          <ul className="flex flex-col gap-3" data-testid="records-list">
            {filter.shown.map((row) => (
              <li key={`${row.retroId}:${row.rid}`} className="flex flex-col">
                <RecordsRow row={row} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </AppShell>
  )
}
