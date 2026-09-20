import type { AppRouterOutputs } from '@retro/api'
import { ActorTag } from '@/components/actor-tag'
import { Reference } from '@/components/records/record-lifecycle'
import type { DecisionState } from '@/components/review/decision-state'
import { whenText } from '@/lib/when'

type Timeline = AppRouterOutputs['records']['byId']['timeline']
type Entry = Timeline[number]
/** The **act** somebody took, which is four words where the standing is three. */
type LifecycleAct = Extract<Entry, { kind: 'lifecycle' }>['status']

/**
 * What a verdict did, in the past tense a history is read in.
 *
 * `pending` is on the list because a reviewer can put a record back to pending
 * by pressing the verdict it already wears, and that press appends a version
 * like any other (`decision.model.ts`) — so it is a thing somebody did and it
 * belongs on the list of things somebody did. `hold` is on it because an early
 * store carries rows in that state and every reader of a
 * verdict has to go on answering for one (`r-hold-semantics`).
 *
 * `Record<DecisionState, …>` refuses to compile with a state missing, so a
 * verdict added to the wire enum has to be given a word before this list can
 * show it.
 */
const VERDICT_TAKEN: Record<DecisionState, string> = {
  pending: 'Moved back to pending',
  approved: 'Approved',
  declined: 'Declined',
  revise: 'Sent back for a revision',
  hold: 'Held',
}

/**
 * What a lifecycle act did. Four words, where the tag on the header wears one of
 * three: `reopened` and `unarchived` both leave a record `open`, and a history
 * that called them both "opened" would be dropping the difference between a fix
 * that did not hold and a record brought back off the shelf.
 */
const ACT_TAKEN: Record<LifecycleAct, string> = {
  resolved: 'Resolved',
  reopened: 'Reopened',
  archived: 'Archived',
  unarchived: 'Unarchived',
}

/**
 * How a record got to where it is — a timeline at the bottom of the page showing
 * how the record evolved, with events like status changes.
 *
 * **A plain chronological list and nothing else.** One line per event, reading
 * who · what · when, in the order it happened. No grouping by kind, no filters,
 * no collapse, no icons of its own: the vocabulary is the page's own — the actor
 * tag every surface names an actor with, the reference rendering the resolve
 * evidence uses — and a history that needed a legend would be a second visual
 * language for the least surprising thing on the page.
 *
 * **Comments are not on it**, deliberately. A record's conversation is on its
 * review page, where it is written.
 *
 * **It never renders empty.** Every record has at least the draft it was filed
 * in, so the one branch a list like this usually needs — the empty state — is
 * unreachable through the product, and an empty-state message here would be a
 * branch no scenario could reach (`r-untested-rendered-branch`).
 */
export function RecordTimeline({ timeline }: { timeline: Timeline }) {
  return (
    <section className="flex flex-col gap-2" data-testid="record-timeline">
      <h2 className="section-label">Timeline</h2>
      <ol className="flex flex-col gap-2.5" data-testid="record-timeline-list">
        {timeline.map((entry) => (
          <li
            // The pair is what makes a key: a record can be decided and resolved
            // in the same second (a frozen clock, or two acts in one unit of
            // work), and `at` alone would then be one key on two lines.
            key={`${entry.kind}:${entry.at}:${keyOf(entry)}`}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-1"
            data-testid="record-timeline-entry"
          >
            <ActorTag party={entry.actor} testId="record-timeline-actor" />
            <span className="text-sm leading-relaxed" data-testid="record-timeline-what">
              {what(entry)}
            </span>
            {/**
             * The instant on the attribute and the reader's own rendering in the
             * text — which is what a `<time>` element is for, and what lets a
             * scenario assert a moment without asserting the machine's locale
             * (`lib/when.ts`).
             */}
            <time className="meta-mono" dateTime={entry.at} data-testid="record-timeline-when">
              {whenText(entry.at)}
            </time>
            {entry.kind === 'lifecycle' && entry.refs.length > 0 ? (
              <ul className="flex w-full flex-col gap-1 pl-1" data-testid="record-timeline-refs">
                {entry.refs.map((ref) => (
                  <li key={ref}>
                    {/* Linked when it names a web address and printed as typed
                        when it does not — the same one question the records
                        page asks of a reference. */}
                    <Reference reference={ref} />
                  </li>
                ))}
              </ul>
            ) : null}
            {entry.kind === 'lifecycle' && entry.note !== null ? (
              <p
                className="w-full text-muted-foreground text-sm leading-relaxed"
                data-testid="record-timeline-note"
              >
                {entry.note}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  )
}

/**
 * The line itself. Each kind says the one thing that distinguishes it: which
 * draft a record arrived in, which draft a verdict was given against (a
 * verdict binds to the content it was given for, so which content matters), and
 * nothing beside a lifecycle act, because an act is taken against the record
 * rather than against a draft of it.
 */
function what(entry: Entry): string {
  switch (entry.kind) {
    case 'created':
      return `Filed in revision ${entry.revision}`
    case 'decision':
      return `${VERDICT_TAKEN[entry.state]} against revision ${entry.revision}`
    case 'lifecycle':
      return ACT_TAKEN[entry.status]
  }
}

/** What tells two events of the same kind apart: their version, or the draft they name. */
function keyOf(entry: Entry): number {
  return entry.kind === 'created' ? entry.revision : entry.version
}
