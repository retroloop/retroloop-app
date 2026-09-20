import { Link } from '@tanstack/react-router'
import { ActorTag } from '@/components/actor-tag'
import { RecordLabelTags } from '@/components/records/record-labels'
import {
  LifecycleControl,
  LifecycleTag,
  type RecordListRow,
  ResolvedEvidence,
} from '@/components/records/record-lifecycle'
import { DecisionStateTag } from '@/components/review/decision-state'
import { optionFor, SEVERITIES } from '@/lib/enum-labels'
import { retroIdentityLine } from '@/lib/retro-identity'

/**
 * One record, wherever it came from — the row behind the page that lists every
 * record flat, in one place, irrespective of the session, the retrospective or
 * the working directory.
 *
 * It is deliberately not a small review card. What a reader does here is find a
 * record and see where it stands, and the record itself is one click away on its
 * own page. So the row carries identity, the two states, who raised it, how bad
 * it is, where it happened, and what has been done about it — and stops. The
 * problem statement, the solutions, the reviewer's note and the comments are all
 * one navigation away and none of them is here.
 *
 * **That click used to land on the review page** (there was no per-record detail
 * page, so the review's `?record=` anchor was it), and it read as a bug: clicking
 * a record on the records page took the reader to the retrospective page, when
 * each record should have its own dedicated page. So the link is
 * `/records/:globalId` now, and the way to the
 * retrospective is on that page. The anchor did not go
 * away: it is what the record page's own link to its review carries.
 *
 * **One link, and the number in it.** The row shows `#globalId` and the URL is
 * that same number, which is what makes a row something a reader can cite — and
 * there is no second link to the retrospective beside it, because two links out
 * of one row is a row asking which one you meant.
 *
 * The reading order is the order the questions get asked: *which record is this*
 * (the link), *where does it stand* (the marks), *where did it come from* (the
 * identity line), *what has been done about it* (the evidence and the control).
 */
export function RecordsRow({ row }: { row: RecordListRow }) {
  return (
    <article
      // Keyed by the pair, everywhere, because a rid is minted per
      // retrospective and two retros can mint the same one. This is the
      // only page in the product that can hold both at once.
      data-testid={`records-row-${row.retroId}-${row.rid}`}
      className="flex flex-col gap-2.5 rounded-xl border border-hairline bg-card px-4 py-3.5"
    >
      {/**
       * The whole identity is the link, `#n · title` together, because that pair
       * is what names a record everywhere else in this product and half of it is
       * not a thing anyone would click.
       *
       * The number is the record's place in the **whole ledger**, not in its own
       * retrospective, because per-retrospective ids all start from #1 and repeat
       * across the store. This page is where that shows: seven rows from three
       * retrospectives, three of them opening with "#1". The link still goes by
       * `(retroId, rid)`, which is what actually addresses a record.
       */}
      <Link
        to="/records/$recordId"
        params={{ recordId: String(row.globalId) }}
        data-testid="records-row-link"
        className="flex flex-wrap items-baseline gap-2 hover:underline"
      >
        <span className="meta-mono" data-testid="records-row-num">
          #{row.globalId}
        </span>
        <span className="font-semibold text-base leading-snug tracking-tight">{row.title}</span>
      </Link>

      <div className="flex flex-wrap items-center gap-2">
        <DecisionStateTag state={row.state} />
        <LifecycleTag status={row.lifecycle.status} />
        <Severity severity={row.severity} />
        <ActorTag party={row.requester} testId="records-row-requester" />
        {/* What the record wears, read-only — the row is where a reader finds a
            record, and the label filter on the bar above is what they narrow by.
            Editing happens on the record's own page. */}
        <RecordLabelTags labels={row.labels} testId="records-row-label" />
      </div>

      {/**
       * The same identity line the dashboard row and the review header carry,
       * from the same function (`lib/retro-identity.ts`) — which matters more
       * here than anywhere: this is the only page where two of them are on
       * screen at once, so it is the only page where a reader has to tell them
       * apart at a glance.
       */}
      <p className="meta-mono break-words" data-testid="records-row-identity">
        {retroIdentityLine(row)}
      </p>

      <ResolvedEvidence lifecycle={row.lifecycle} />

      {/* A row offers at most two acts — what to do about the record, and
          whether to keep it in the list at all — so they sit side by side
          rather than behind anything. */}
      <div className="flex flex-wrap items-center gap-1">
        <LifecycleControl row={row} />
      </div>
    </article>
  )
}

/**
 * How bad it is, in the one word a reader addresses it by — "sev 4", not the
 * rubric line behind it.
 *
 * The short form is the tab strip's own precedent (`Solution 2 · L2`): a compact
 * marker in a list, with the canonical label whole one click away on the review
 * page, where the reviewer is actually judging the number. Nothing here
 * contradicts that label, which is the standing rule (`lib/enum-labels.ts`), and
 * the word comes off `SEVERITIES` rather than being spelled out here so it
 * cannot drift from it.
 */
function Severity({ severity }: { severity: RecordListRow['severity'] }) {
  const option = optionFor(SEVERITIES, severity)
  return (
    <span className="meta-mono" data-testid="records-row-severity">
      {option === undefined ? `SEV${severity}` : option.name}
    </span>
  )
}
