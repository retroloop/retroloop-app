import type { DomainEvent } from '#domain/events/domain-event.model'
import type { Revision } from '#domain/models/revision.model'

/**
 * A revision without its records. Reads that return record views alongside would
 * otherwise ship every narrative twice — once embedded, once projected.
 */
export type RevisionMeta = {
  readonly id: number
  readonly retroId: number
  readonly n: number
  readonly createdAt: string
  /** The name this draft proposed for the retrospective; the latest one wins. */
  readonly title: string | undefined
  readonly records: number
  /**
   * When the human finished **this round**, and absent while they have not.
   *
   * Per revision, which is the whole point of it: `retrospective.finishedAt` is
   * the retro's own close, written once by `ReviewClosed` at the very end, and a
   * page asking "has this round been put down?" was reading it and getting null
   * through every round but the last. There is no `review.status` procedure to
   * ask instead — `review.finish` is that router's only member — so the fact
   * rides on the revision it is about.
   *
   * Derived from the `ReviewFinished` event, which is the only record of the act
   * (`finish-review.use-case.ts` appends it; the CLI's `review wait` blocks on
   * it; `close-review.use-case.ts` refuses without it). Nothing is written to
   * answer this — the same reading `effectiveDecision` and `effectiveLifecycle`
   * give their own axes.
   */
  readonly finishedAt: string | undefined
}

/**
 * When each round was finished, keyed by revision number.
 *
 * Built once per read and handed to `toRevisionMeta` rather than looked up per
 * revision, so a retrospective with N revisions still costs one events read. A
 * round finished twice cannot happen — `finish-review.use-case.ts` absorbs a
 * repeat press without appending a second event — but the earliest is taken
 * anyway, because "when was it finished" has one honest answer and it is the
 * first time it was said.
 */
export function finishedAtByRevision(events: readonly DomainEvent[]): ReadonlyMap<number, string> {
  const finished = new Map<number, string>()
  for (const event of events) {
    if (event.name !== 'ReviewFinished' || event.revisionN === undefined) continue
    if (!finished.has(event.revisionN)) finished.set(event.revisionN, event.at)
  }
  return finished
}

export function toRevisionMeta(
  revision: Revision,
  finishedAt: string | undefined = undefined,
): RevisionMeta {
  return {
    id: revision.id,
    retroId: revision.retroId,
    n: revision.n,
    createdAt: revision.createdAt,
    title: revision.title,
    records: revision.records.length,
    finishedAt,
  }
}
