import { Link } from '@tanstack/react-router'
import type { RetroListRow } from '@/components/dashboard/wire'
import { RetroStateTag } from '@/components/retro-state'
import { relativeWhen } from '@/lib/relative-when'
import { retroName } from '@/lib/retro-identity'
import { type Sitting, sittings } from '@/lib/session-ledger'
import { cn } from '@/lib/utils'

/**
 * **The diary view, refined** — session-12 direction 4: the session-card view
 * survives, and takes two corrections.
 *
 * The arrangement is ported from `lane/s11-var-b` @55b15c0, which is the grouping
 * the owner *"somewhat"* liked: retrospectives gathered into the sittings that
 * produced them, sittings newest first, retrospectives inside a sitting in the
 * order they happened. Why the session is the unit and why the two orders run
 * opposite ways is argued where the grouping lives (`lib/session-ledger.ts`); it
 * came across unchanged, because the part he liked is the part that should not
 * move.
 *
 * **Correction one — the dates.** *"the dates should be relative when they are not
 * too far off."* The card led with `Aug 27, 2026, 6:57 AM`, which is the right
 * string for a timeline and the wrong one for a diary: the reading a diary is
 * arranged for is "what was I doing lately", and every absolute stamp makes the
 * reader do a subtraction to get there. So the header now says "2 hours ago" or
 * "yesterday" inside a week and falls back to the date outside it — the boundary,
 * and why it is a week, are in `lib/relative-when.ts`. The ISO instant stays on
 * the `<time dateTime>` attribute, which is where the machine-readable half
 * belongs and the half anything asserting against this reads.
 *
 * **Correction two — the ids.** *"the [retros] need to have their global ids
 * displayed rather than session's internal [sequence] number."* The row said
 * `#1`, which is `retroNumber` — a retrospective's position *within its session*.
 * Three of his fourteen retrospectives are "#1" and two more are "#2", so the
 * number he was shown could not identify the thing it was printed on, and the
 * link it sat inside went to a different number entirely. The row now says
 * `Retro 13`, which is `retroId`: minted once, unique across the store, and the
 * number every URL, breadcrumb and record page already uses.
 *
 * **And the *name* follows the same rule since D5.** An untitled retrospective
 * used to fall back to `Retro #1 — retro`, so a row could print the global id in
 * one column and the per-session number as the name three characters away. The
 * fallback now reads `Retro 2 — retro`, fixed once in
 * `lib/retro-identity.ts` so the review header and the record page inherit it
 * rather than this page carrying a local copy.
 *
 * The absolute date has not gone anywhere on the far side of the boundary, and
 * `retroNumber` has not gone anywhere either — it is still what the review page's
 * identity line says, because "Session 10 · Retro #1" is a true sentence about
 * where a retrospective sits and is the line KC-0020 settled. What changed is
 * which of the two numbers a *list* prints, and the answer is the one that is
 * unique.
 */

/**
 * How much room the diary gets. The three variations disagree about this and it
 * is one of the round's real questions: on a page whose subject is a corpus, is
 * the history of the work the body of the page or the provenance at the foot of
 * it?
 *
 * - `full` — a card per sitting, the time leading, every retrospective a ruled
 *   row. The diary as the page.
 * - `compact` — one card, every sitting a ruled group inside it, the time
 *   demoted to a line of meta. The diary as the footnote that says where the
 *   numbers above came from.
 */
export type Density = 'full' | 'compact'

export function SessionLedger({
  retros,
  density,
  /** The clock, so the relative half is provable rather than merely observed. */
  now = new Date(),
}: {
  retros: readonly RetroListRow[]
  density: Density
  now?: Date
}) {
  const ledger = sittings(retros)

  if (ledger.length === 0) {
    /**
     * Only ever true on a fresh install: a retrospective is what this product
     * makes, and nothing deletes one. So it says the one true thing and stops —
     * an onboarding panel here is a panel the owner sees once and every later
     * reader never sees at all.
     */
    return (
      <p className="text-muted-foreground text-sm" data-testid="ledger-empty">
        No retrospectives yet. The first one lands here when the AI files a revision.
      </p>
    )
  }

  if (density === 'compact') {
    return (
      <div
        data-testid="session-ledger"
        data-density="compact"
        className="overflow-hidden rounded-xl border border-hairline bg-card"
      >
        {ledger.map((sitting) => (
          <CompactSitting key={sitting.session.id} sitting={sitting} now={now} />
        ))}
      </div>
    )
  }

  return (
    <div data-testid="session-ledger" data-density="full" className="flex flex-col gap-4">
      {ledger.map((sitting) => (
        <FullSitting key={sitting.session.id} sitting={sitting} now={now} />
      ))}
    </div>
  )
}

/** One sitting as a card of its own: the time leads, the retrospectives are ruled rows. */
function FullSitting({ sitting, now }: { sitting: Sitting<RetroListRow>; now: Date }) {
  const { session, retros } = sitting
  const when = relativeWhen(session.startedAt, now)

  return (
    <article
      data-testid={`session-card-${session.id}`}
      className="overflow-hidden rounded-xl border border-hairline bg-card"
    >
      <header className="flex flex-col gap-1 px-4 pt-3.5 pb-3 sm:px-5">
        <time
          data-testid="session-time"
          data-when={when.form}
          dateTime={session.startedAt}
          className="font-medium text-[0.9375rem] tracking-tight"
        >
          {when.text}
        </time>
        {/* Wraps rather than truncates: a working directory that has lost its
            middle is a directory the reader cannot recognise. */}
        <span data-testid="session-identity" className="meta-mono break-words">
          Session {session.id} · {session.cwd}
        </span>
      </header>

      <div className="px-4 sm:px-5">
        <ul className="flex flex-col">
          {retros.map((retro) => (
            <RetroLine key={retro.retroId} retro={retro} />
          ))}
        </ul>
      </div>
    </article>
  )
}

/** One sitting as a ruled group inside a shared card: the time is meta, not a heading. */
function CompactSitting({ sitting, now }: { sitting: Sitting<RetroListRow>; now: Date }) {
  const { session, retros } = sitting
  const when = relativeWhen(session.startedAt, now)

  return (
    <section
      data-testid={`session-card-${session.id}`}
      className="border-hairline border-t first:border-t-0"
    >
      <header className="flex flex-wrap items-baseline gap-x-2 bg-surface px-4 py-2 sm:px-5">
        <time
          data-testid="session-time"
          data-when={when.form}
          dateTime={session.startedAt}
          className="font-medium text-xs"
        >
          {when.text}
        </time>
        <span data-testid="session-identity" className="meta-mono">
          Session {session.id}
        </span>
      </header>
      <div className="px-4 sm:px-5">
        <ul className="flex flex-col">
          {retros.map((retro) => (
            <RetroLine key={retro.retroId} retro={retro} compact />
          ))}
        </ul>
      </div>
    </section>
  )
}

/**
 * One retrospective, as a line in its sitting.
 *
 * The whole line is the link: there is exactly one thing to do with a
 * retrospective, and making the reader aim at a word inside it would be a smaller
 * target for no reason.
 *
 * `counts.decided` is what a finished round has to say. Before the diary it said
 * nothing at all — no pending count, no state worth reading — which on a page
 * that is a work diary is the wrong answer twice over: what came out of the
 * sitting *is* the entry.
 */
function RetroLine({ retro, compact }: { retro: RetroListRow; compact?: boolean }) {
  return (
    <li className="border-hairline border-t first:border-t-0">
      <Link
        to="/retros/$retroId"
        params={{ retroId: String(retro.retroId) }}
        data-testid={`retro-row-${retro.retroId}`}
        className={cn(
          // Negative margin so the hover surface reaches the card's padding edge
          // while the rules stay at the inset the header sets. A row that
          // highlighted only its text would look like the rule had come loose.
          'group -mx-2 flex flex-col gap-1 rounded-lg px-2 transition-colors hover:bg-surface-raised',
          'sm:flex-row sm:items-center sm:gap-4',
          compact ? 'py-2' : 'py-3',
        )}
      >
        {/* The global id — direction 4. `Retro 13`, not `#1`: the word is not
            repeated down the card because the number is already unique without
            it, and the two characters it costs buy an id a reader can act on. */}
        <span
          data-testid="retro-global-id"
          className="meta-mono shrink-0 tabular-nums sm:w-[4.5rem]"
        >
          Retro {retro.retroId}
        </span>

        <span
          data-testid="retro-name"
          className={cn(
            'min-w-0 flex-1 truncate tracking-tight group-hover:text-primary',
            compact ? 'text-sm' : 'font-medium text-[0.9375rem]',
          )}
        >
          {retroName(retro)}
        </span>

        <div className="flex shrink-0 items-center gap-2.5 tabular-nums">
          {/* Decided before pending: what the round settled, then what it still
              owes. Hidden at zero rather than receding to a grey "0 decided" —
              a round nobody has answered has produced nothing, and the honest
              rendering of nothing is nothing. */}
          {retro.counts.decided > 0 ? (
            <span data-testid="retro-decided" className="text-[0.6875rem] text-muted-foreground">
              {retro.counts.decided} decided
            </span>
          ) : null}

          {/* Only while the round is his. `submitted` is not: the finish gate
              means it is normally zero anyway, and in the one window where it is
              not — a verdict taken back after the press, which this page does not
              forbid — a count beside a SUBMITTED tag would contradict it
              (`live-band.tsx` makes the same call, at length). */}
          {retro.state === 'reviewing' ? (
            <span
              data-testid="retro-pending"
              className="font-medium text-[0.6875rem] text-muted-foreground"
            >
              {retro.counts.pending} pending
            </span>
          ) : null}

          <RetroStateTag state={retro.state} />
        </div>
      </Link>
    </li>
  )
}
