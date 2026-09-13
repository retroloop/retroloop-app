/**
 * The outbox (KC-0005). Every write appends its event in the same unit of work as
 * the data it describes, so a viewer that reads the events table has, by
 * construction, seen every committed change.
 *
 * Consumers: the server's tailer (→ SSE fan-out) and `review wait`, which polls
 * this table from its own process.
 */
export const EVENT_NAMES = [
  'SessionCreated',
  'NoteAdded',
  'AnnotationAdded',
  'RetrospectiveStarted',
  'RevisionCreated',
  'DecisionRecorded',
  // The lifecycle axis, beside the verdict one (`r-hold-semantics`). Two names
  // rather than one `HoldChanged`, because the two acts are two procedures and a
  // consumer that cares which happened should not have to read the payload.
  'HoldSet',
  'HoldCleared',
  'CommentAdded',
  // The human declaring a thread dealt with, and taking it back
  // (`r-resolvable-comments`). Two names rather than one `ThreadResolutionSet`,
  // for the reason the hold pair gives above: a page that only wants to collapse
  // a thread should not have to read a payload to learn which way it went.
  'ThreadResolved',
  'ThreadReopened',
  // A record marked done, and taken back — the lifecycle beside the verdict
  // (the owner's session-8 ask). Two names for the reason the two pairs above
  // give, and a third reason of their own: **either actor may append one**, so
  // a consumer watching for "the AI finished something" reads the name and the
  // scope rather than unpacking a payload to find out which way it went.
  'RecordResolved',
  'RecordReopened',
  // The same axis, one position further out (the owner's session-9 ask): a
  // record put out of the way, and brought back. A name per act again, and the
  // pair is **human-only** where the two above take either actor — so the name
  // is also what tells a consumer that a person did this.
  'RecordArchived',
  'RecordUnarchived',
  /**
   * The two vocabularies being edited — the settings page's four acts, per
   * primitive. A name per act rather than one `LabelDefinitionChanged`, on the
   * standing every pair above sets: a reader should not have to unpack a payload
   * to learn whether a label appeared, was renamed, stopped being offered, or
   * came back.
   *
   * **`LabelUnretired` is a name and not the absence of one** (retro-11
   * `r-retire-burns-a-word`, his selected solution): un-retire is symmetric with
   * retire, the same way `RecordUnarchived` is with `RecordArchived`, and the
   * row saying a word came back into the vocabulary is exactly as much of the
   * audit trail as the row saying it left.
   *
   * **These are the only events in the set with no scope at all.** A definition
   * is global — which is why the owner asked for a settings page — so there is
   * no session, retrospective, revision or record to address them to, and
   * `events.onRetro` therefore delivers none of them to any page. They are
   * written anyway, because the outbox is this store's audit trail: *"the user
   * can be certain that the AI cannot mess around"* is a claim these rows are
   * the evidence for, alongside the two below.
   */
  'LabelDefined',
  'LabelRenamed',
  'LabelRetired',
  'LabelUnretired',
  'AttributeDefined',
  'AttributeRenamed',
  'AttributeRetired',
  'AttributeUnretired',
  /**
   * The human's permission switch, moved (OWNER RULING 2). Two names for the
   * reason every pair here has two, and one of its own: a row saying the AI was
   * *granted* config-write access is the single most interesting line in this
   * table, and reading it should not mean parsing a payload.
   */
  'AiConfigWriteEnabled',
  'AiConfigWriteDisabled',
  /**
   * A label put on a record, and taken off — human-only writes, scoped to the
   * retrospective and the record and carrying no `revisionN`, because a label
   * outlives every redraft of the record it is on (the same reasoning the four
   * `Record*` lifecycle names give).
   */
  'RecordLabelApplied',
  'RecordLabelRemoved',
  /** A value set on a record, and cleared. Same scope, same reasoning. */
  'RecordAttributeSet',
  'RecordAttributeCleared',
  /**
   * Two records said to belong together, and taken apart again — the owner's
   * session-11 ask. A name per act on the standing every pair here sets, and two
   * reasons of its own:
   *
   * - **either actor may append one**, which this shares only with the four
   *   `Record*` lifecycle names — so a consumer watching for *"the AI found a
   *   repeat of something"* reads the name and the scope rather than unpacking a
   *   payload.
   * - the row it describes **names two records, and the scope addresses one**.
   *   `EventScope` carries one retrospective and one rid because that is what
   *   every consumer filters on, and a relation is the one thing in this store
   *   that deliberately crosses retrospectives; so the event is addressed to the
   *   record the act was taken **from**, and both global ids ride in the payload
   *   (`relate-records.use-case.ts`). No `revisionN` on either, because a
   *   relation outlives every redraft of the records it names.
   */
  'RecordRelated',
  'RecordUnrelated',
  /**
   * A record picked up, and given back — the in-progress marker
   * (`record-claim.model.ts`). A name per act on the standing every pair here
   * sets, and two reasons of its own:
   *
   * - **it is the one pair here that goes stale.** A consumer watching the lane
   *   wants "somebody took #12" as it happens, and a payload it has to unpack to
   *   learn which way the marker moved is a payload it unpacks on every row.
   * - **`RecordUnclaimed` is also written by a resolve**, in the same unit of
   *   work as `RecordResolved` and immediately after it
   *   (`set-record-lifecycle.use-case.ts`): the work is finished, so the marker
   *   comes down. That is the one place in this set where one act appends two
   *   names, and reading the pair in order is what makes it legible.
   *
   * Either actor may append one, like the four `Record*` lifecycle names above.
   * No `revisionN`: a claim outlives every redraft of the record it is on.
   */
  'RecordClaimed',
  'RecordUnclaimed',
  'RequestOpened',
  'RequestResponded',
  'RequestClosed',
  // Frozen since retro 4 `r-one-finish-button`: nothing appends a
  // `ChangesRequested` any more — the second button that raised it is gone and
  // so is its use case. The name stays because a store written before the
  // removal holds rows carrying it, and every reader must go on parsing one.
  'ChangesRequested',
  /** The human's side of a round is closed. Not a state change — see below. */
  'ReviewFinished',
  /** The AI closed the review to export: `reviewing → finished`, terminal. */
  'ReviewClosed',
] as const

export type EventName = (typeof EVENT_NAMES)[number]

/**
 * `review wait` terminates on these, for its retrospective.
 *
 * **One name, since retro 4 `r-one-finish-button`.** The pair mirrored the two
 * buttons the review page used to carry, and the owner removed one of them —
 * *"there should be just one button… it should be clear from the content of the
 * comments rather than from a redundant button I can press wrong."* So the wait
 * says only *that* he is done, and what happens next comes from what he wrote.
 *
 * The old-store edge, stated: a `ChangesRequested` row written before this
 * change no longer unblocks a wait. It cannot matter in practice — such a row is
 * always older than the revision the wait starts from (`review wait` tails from
 * the latest `RevisionCreated`), and the AI that was waiting on it has long
 * since answered it with a new revision.
 */
export const REVIEW_WAIT_EVENT_NAMES = ['ReviewFinished'] as const

/** Flat scalars only: an event row stores this as one JSON column. */
export type EventData = Readonly<Record<string, string | number | boolean | null>>

/**
 * The addressing fields every consumer filters on are columns, not payload, so a
 * tailer can select "everything for retro 12" without parsing JSON.
 */
export type EventScope = {
  readonly sessionId: number | undefined
  readonly retroId: number | undefined
  readonly revisionN: number | undefined
  readonly rid: string | undefined
}

export type DomainEvent = EventScope & {
  /** Monotonic; doubles as the SSE `Last-Event-ID` cursor. */
  readonly id: number
  readonly name: EventName
  readonly at: string
  readonly data: EventData
}

export type NewDomainEvent = Omit<DomainEvent, 'id'>

/**
 * Builds the row a use case appends. Every scope field is optional here and
 * required on the type, so an event can never silently lose its addressing: the
 * writer names what it knows and the rest is explicitly absent.
 */
export function newDomainEvent(
  name: EventName,
  at: string,
  scope: Partial<EventScope> = {},
  data: EventData = {},
): NewDomainEvent {
  return {
    name,
    at,
    data,
    sessionId: scope.sessionId,
    retroId: scope.retroId,
    revisionN: scope.revisionN,
    rid: scope.rid,
  }
}
