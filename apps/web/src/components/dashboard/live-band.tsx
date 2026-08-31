import { Link } from '@tanstack/react-router'
import { ArrowRightIcon } from 'lucide-react'
import type { RetroListRow } from '@/components/dashboard/wire'
import { RetroStateTag } from '@/components/retro-state'
import { Button } from '@/components/ui/button'
import { relativeWhen } from '@/lib/relative-when'
import { retroName } from '@/lib/retro-identity'

/**
 * **The exclusive surface for retrospectives that are still going on** — the
 * owner's session-12 direction 6: *"if there is an open / ongoing retro, it
 * should be shown somewhere exclusively."*
 *
 * "Exclusively" is the whole specification and it has two halves. A live
 * retrospective gets a surface **no finished retrospective can appear on**, which
 * is what makes it findable without reading: if the band is there, something
 * wants him; if it is not, nothing does. And it gets that surface **only while it
 * is live** — the band is absent on a cold store rather than present and empty,
 * because a permanent strip reading "no open retrospective" is a control that has
 * earned nothing and, worse, teaches the reader to stop looking at the one place
 * the page reserved for urgency.
 *
 * **It renders one row per live retrospective, not just the newest.** The owner's
 * ruling was explicit — *one OR MORE active retros* — and the plural is not
 * hypothetical padding: a session opens a retrospective at a time today, but
 * `retros.list` can carry two the moment two sessions overlap, and a band that
 * silently showed one of them would hide a round he had not answered. So the
 * surface is a list with one entry each, newest first, and the heading counts
 * them when there is more than one.
 *
 * **What the direction round had here and this does not: the preview toggle.**
 * That control existed so the band could be reviewed on a store whose every
 * retrospective was `finished`. It was round scaffolding and the owner said so;
 * it does not ship, and neither does the synthetic retrospective it injected.
 *
 * **Which retrospectives count.** Everything that is not `finished` — `open`,
 * `reviewing` and `submitted` alike. An `open` retro is one the AI is still
 * drafting, a `reviewing` one is waiting on him, and a `submitted` one is the
 * window he asked for: his round is down and the AI has not closed it. Only the
 * middle one is urgent, but all three are rounds in flight, and a dashboard that
 * only lit up at the handover would go dark for exactly the stretches where he
 * might want to know something was moving. The state tag says which, in the
 * review page's own words.
 */

/**
 * The retrospectives in flight, newest first.
 *
 * Sorted by `retroId` descending so the order is total and stable: two rounds
 * opened in the same session would otherwise appear in whatever order the array
 * happened to hold, and a surface whose order changes between renders for no
 * visible reason is one a reader stops trusting.
 */
export function liveRetros(retros: readonly RetroListRow[]): readonly RetroListRow[] {
  return [...retros]
    .filter((retro) => retro.state !== 'finished')
    .sort((left, right) => right.retroId - left.retroId)
}

export function LiveBand({ retros }: { retros: readonly RetroListRow[] }) {
  const live = liveRetros(retros)

  // The whole of "renders nothing on a cold store", in one line and at the top,
  // where a reader looking for that guarantee will find it.
  if (live.length === 0) return null

  return (
    <section
      data-testid="live-band"
      data-count={live.length}
      aria-label={live.length === 1 ? 'Retrospective in flight' : 'Retrospectives in flight'}
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-tone-amber/40 bg-tone-amber-soft/40"
    >
      <header className="flex items-center gap-2 px-4 pt-3.5 pb-1 sm:px-5">
        {/* The mark that says *live*, and the only animated thing on this page. A
            pulse is legitimate here for the reason a spinner is: it encodes that
            the state is still changing. Anywhere else on a dashboard it would be
            decoration. */}
        <span
          aria-hidden
          data-testid="live-pulse"
          className="relative flex size-2 shrink-0 items-center justify-center"
        >
          <span className="absolute inline-flex size-2 animate-ping rounded-full bg-tone-amber opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-tone-amber" />
        </span>
        {/* Counted in brackets when there is more than one, per direction 3's rule
            for every counted item — and absent at one, because "(1)" beside a
            single row is a number the reader has to read to learn nothing. */}
        <h2 className="section-label text-foreground" data-testid="live-heading">
          {live.length === 1 ? 'Retro in flight' : `Retros in flight (${live.length})`}
        </h2>
      </header>

      <ul className="flex min-w-0 flex-col">
        {live.map((retro) => (
          <li
            key={retro.retroId}
            className="border-tone-amber/25 border-t px-4 py-3.5 first:border-t-0 sm:px-5"
          >
            <LiveRow retro={retro} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/** One round in flight: what it is, where it is, and what it is waiting on. */
function LiveRow({ retro }: { retro: RetroListRow }) {
  const when = relativeWhen(retro.session.startedAt, new Date())
  /**
   * Whether this round is **his** — the one live state that owes him something.
   * `submitted` is deliberately not one: he has put the round down, and the row
   * that says so must not also count what it would owe him if he had not.
   */
  const waiting = retro.state === 'reviewing'

  return (
    <div
      data-testid={`live-row-${retro.retroId}`}
      className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:gap-4"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid="live-title"
            className="truncate font-semibold text-[0.9375rem] tracking-tight"
          >
            {retroName(retro)}
          </span>
          <RetroStateTag state={retro.state} />
        </div>
        {/* The global id, per direction 4 and D5 — `retroId`, never
            `retroNumber`, which counts per session and repeats across the store. */}
        <span data-testid="live-identity" className="meta-mono break-words">
          Retro {retro.retroId} · session {retro.session.id} · opened{' '}
          <time dateTime={retro.session.startedAt}>{when.text}</time>
        </span>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-4">
        {/**
         * What the round is waiting on, and only while it is waiting. A round
         * the AI is still drafting owes him nothing yet, and a round he has
         * already submitted owes him nothing any more; "0 pending" on either
         * would be a number to read and dismiss — the same call the diary's rows
         * make.
         *
         * The one edge, stated because it is reachable rather than because it is
         * likely: the window after a finish is not read-only, so he can take a
         * verdict back and leave a `submitted` round with a pending record in
         * it. The figures stay away then too. A count under a tag that says he
         * is done is two claims about the same round, and the one that matters —
         * that the AI cannot close it — is the one the AI is already told, by
         * the gate that refuses the close and by `review status`.
         *
         * Term first in the document, number first on the screen — the same
         * conforming pair the stat tiles draw, and argued at `pieces.tsx`
         * §StatTile. This band was written from that component's shape and
         * inherited its inverted list with it.
         */}
        {waiting ? (
          <dl className="flex items-baseline gap-4 tabular-nums">
            <div className="flex flex-col-reverse">
              <dt className="text-muted-foreground text-xs">awaiting you</dt>
              <dd data-testid="live-pending" className="font-semibold text-2xl leading-none">
                {retro.counts.pending}
              </dd>
            </div>
            <div className="flex flex-col-reverse">
              <dt className="text-muted-foreground text-xs">decided</dt>
              <dd data-testid="live-decided" className="font-semibold text-2xl leading-none">
                {retro.counts.decided}
              </dd>
            </div>
          </dl>
        ) : null}

        <Button size="sm" variant={waiting ? 'default' : 'outline'} asChild>
          <Link
            to="/retros/$retroId"
            params={{ retroId: String(retro.retroId) }}
            data-testid="live-open"
          >
            {waiting ? 'Review it' : 'Open it'}
            <ArrowRightIcon aria-hidden className="size-3.5" />
          </Link>
        </Button>
      </div>
    </div>
  )
}
