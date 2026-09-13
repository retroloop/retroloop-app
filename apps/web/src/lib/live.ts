import { useQueryClient } from '@tanstack/react-query'
import { useSubscription } from '@trpc/tanstack-react-query'
import { useCallback, useState } from 'react'
import { useTRPC } from '@/lib/trpc'

/**
 * The event → invalidation mapping, in one file, exactly as realtime.md requires.
 * Components never learn that a stream exists: they read queries, and this hook
 * decides which of them stopped being true.
 *
 * The event is a signal, never the data. Everything on screen comes from a
 * refetched query, so two browsers watching the same retrospective converge on
 * what the database says rather than on what each of them was told.
 */
export type LiveSession = {
  /**
   * A revision the AI filed while the human was reading — **announced, not
   * swapped in** (KC-0005). The page keeps showing what the reviewer was reading
   * until they say otherwise; a verdict has to bind to the content they saw.
   */
  readonly availableRevision: number | null
  /** The reviewer accepted the announcement. Clears it and refetches the retro. */
  readonly acknowledge: () => void
}

/**
 * The three query families this page holds. Named, so the mapping below can be
 * read and tested as data rather than as a run of `invalidateQueries` calls
 * buried in a subscription handler.
 */
export type QueryFamily = 'records' | 'threads' | 'retros'

/**
 * **The mapping**, and the whole of it: what an event's name says has stopped
 * being true. Pure and exported so it can be checked without a browser — the
 * bug it is written this way because of could not be seen from the acting tab
 * at all (below).
 *
 * `RevisionCreated` maps to **nothing**, and that is the one entry that must
 * stay empty: refetching there would move the records under the reviewer's
 * cursor the moment the AI filed a draft, which is the exact failure
 * "announce, don't swap" exists to prevent (KC-0005). The hook raises the
 * banner instead.
 *
 * Every comment event carries `threads` as well as `records`:
 *
 *   - `CommentAdded` always did. The anchor is not on the wire, so both are
 *     refetched and one of them has nothing new — a request, against never
 *     showing the reviewer a stale thread.
 *   - `ThreadResolved` and `ThreadReopened` did **not**, and that was a real
 *     bug (session 7). They fell to the everything-else branch, which
 *     invalidated `records.*` only — true while a record's threads rode on
 *     `records.get`, and false since the comments panel became the one comments
 *     surface and `threads.list` became the one query that holds them. The
 *     acting browser was fine, because the mutation invalidates on its own
 *     success; a *second* browser watching the same retrospective never saw the
 *     thread settle.
 *
 * `ReviewFinished` and `ReviewClosed` carry `retros`: the first is the human's
 * own press arriving back (and any other tab's), the second is the AI closing
 * the review to export — the moment a page that is still open goes read-only, so
 * the state tag and the bar's one action have to follow it (retro 4
 * `r-one-finish-button`).
 *
 * **`RecordRelated` and `RecordUnrelated` fall to that same everything-else
 * branch, and this is the one entry where the default is right for a reason
 * worth writing down.** A relation is only ever rendered on `records.byId`, and
 * that page holds no subscription at all — it refetches on window focus instead,
 * because subscribing would mean a live stream open for one record
 * (`records_.$recordId.tsx`). So `records` here refreshes nothing a subscribed
 * page draws, and it costs one query on a stream nobody is watching for this.
 * What it deliberately cannot do is reach the **other** end: a relation names two
 * records and may name them in two retrospectives, the event is scoped to the one
 * the act was taken from, and this stream is per retrospective — so the far
 * record's page learns on focus like every other reader of it. Widening the map
 * would not change that; only a second scope on the event could, and no page has
 * asked for one.
 *
 * **`RecordClaimed` and `RecordUnclaimed` fall to that branch too, and there the
 * default is the mechanism rather than a fallback** (RL-50). The in-progress
 * badge is drawn from `records.list`, so `records` is exactly the family an
 * agent picking a record up made stale: the card re-reads and the badge appears
 * — or comes down when the record is given back or resolved — with no reload and
 * no second query family involved. Nothing else on the page reads a claim.
 *
 * Everything else lands on `records` alone, which is where `RequestOpened`,
 * `RequestResponded` and `RequestClosed` end up (retro 4 `r-remove-requests`):
 * the panel they refreshed is gone and no procedure reads a request, so there is
 * nothing left for them to make stale. They keep their names in `EVENT_NAMES`
 * because a store written before the removal has rows carrying them and a reader
 * must not choke on one. `ChangesRequested` is in the same position.
 */
export function staleAfter(name: string): readonly QueryFamily[] {
  if (name === 'RevisionCreated') return []
  if (name === 'CommentAdded' || name === 'ThreadResolved' || name === 'ThreadReopened') {
    return ['records', 'threads']
  }
  if (name === 'ReviewFinished' || name === 'ReviewClosed') return ['records', 'retros']
  return ['records']
}

export function useLiveSession(retroId: number): LiveSession {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [availableRevision, setAvailableRevision] = useState<number | null>(null)

  useSubscription(
    trpc.events.onRetro.subscriptionOptions(
      { retroId },
      {
        onData: (event) => {
          if (event.data.name === 'RevisionCreated') {
            setAvailableRevision(event.data.revisionN)
            return
          }

          const pathKey: Record<QueryFamily, readonly unknown[]> = {
            records: trpc.records.pathKey(),
            threads: trpc.threads.pathKey(),
            retros: trpc.retros.pathKey(),
          }
          for (const family of staleAfter(event.data.name)) {
            void queryClient.invalidateQueries({ queryKey: pathKey[family] })
          }
        },
      },
    ),
  )

  const acknowledge = useCallback(() => {
    setAvailableRevision(null)
    void queryClient.invalidateQueries({ queryKey: trpc.retros.pathKey() })
  }, [queryClient, trpc])

  return { availableRevision, acknowledge }
}
