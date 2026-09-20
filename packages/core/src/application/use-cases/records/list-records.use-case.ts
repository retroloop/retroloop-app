import type { Store } from '#application/ports/store.port'
import {
  buildRecordView,
  decisionsByRid,
  globalIdsByRid,
  type RecordViewWithRelations,
  requireGlobalId,
  withLifecycle,
  withRelations,
} from '#application/views/record.view'
import { recordIdsById } from '#application/views/relation.view'
import { NotFoundError } from '#domain/errors/not-found.error'
import type { Actor } from '#domain/models/actor.model'
import type { DecisionState } from '#domain/models/decision.model'
import { claimsByRecord } from '#domain/services/record-claim.service'
import { lifecycleByRecord, lifecycleKey } from '#domain/services/record-lifecycle.service'
import {
  describeRetroRef,
  type RetroRef,
  resolveRetrospective,
  resolveRevision,
} from '#domain/services/reference.service'

export type ListRecordsInput = {
  readonly actor: Actor
  readonly retro: RetroRef
  /** Defaults to the latest revision. */
  readonly revision?: number
  /** Filters on the *effective* state, carry-over included. */
  readonly state?: DecisionState
}

export type ListRecordsOutput = {
  readonly retroId: number
  readonly revisionN: number
  readonly records: readonly RecordViewWithRelations[]
}

/**
 * The records of a revision with the state each one is actually in — a decision
 * carried over from an earlier revision counts as decided, a record whose content
 * changed since it was decided counts as pending (D2).
 *
 * **And where each one stands on the axis that outlives the review**
 * (`r-lifecycle-projection-gap`). This projection answered nothing about
 * lifecycle while the flat one answered correctly, which was found the worst way:
 * after resolving every record of a retrospective, the natural check — `record
 * list --retro <n>` — read as if none of the writes had landed. It is the AI's
 * own read-back channel, so a gap here does not merely look wrong, it invites the
 * conclusion that the store is broken.
 *
 * **The lifecycle is not scoped to the revision, and that is deliberate.** A fix
 * landed against the *record*, not against a draft of it, so `--revision 1` shows
 * the same resolution `--revision 3` does — the same reasoning `record resolve`
 * gives for refusing `--revision` at all.
 *
 * **And what each record was said to have to do with other records**, for the
 * projection gap's reason a second time. A relation is written through the same
 * CLI command a resolve is, and checked the same way — the AI relates a batch
 * and then lists the records to see the writes landed. A listing silent about
 * them would read exactly like a store that refused every one. Relations are
 * not scoped to the revision either, and for a stronger version of the same
 * reason: a relation is not scoped to a *retrospective*.
 */
export class ListRecordsUseCase {
  constructor(private readonly store: Store) {}

  async execute(input: ListRecordsInput): Promise<ListRecordsOutput> {
    const retrospective = NotFoundError.require(
      await resolveRetrospective(this.store, input.retro),
      'retrospective',
      describeRetroRef(input.retro),
    )
    const revision = NotFoundError.require(
      await resolveRevision(this.store.revisions, retrospective.id, input.revision),
      'revision',
      input.revision ?? 'latest',
    )

    const latest = decisionsByRid(await this.store.decisions.listLatestByRetro(retrospective.id))
    /**
     * One read for the whole sequence rather than one per record — and the whole
     * sequence rather than this retrospective's, because the far end of a
     * relation can be in any retrospective and the number on the row is all it
     * gives. Two maps out of one read: the rids of *this* retrospective, which
     * covers every rid it has ever held so an older revision's records are
     * numbered too, and the pair behind every global id anywhere.
     */
    const minted = await this.store.recordIds.listAll()
    const globalIds = globalIdsByRid(minted.filter((record) => record.retroId === retrospective.id))
    const identities = recordIdsById(minted)
    /**
     * The **same read** `records.listAll` makes, keyed the same way. There is no
     * per-retrospective read on this repository and this deliberately does not add
     * one: the two projections joining identical rows through identical helpers is
     * what makes them unable to disagree, which is the whole of what
     * `r-lifecycle-projection-gap` asks for, and the store is hundreds of records
     * for one user (A4).
     */
    const lifecycle = lifecycleByRecord(await this.store.recordLifecycle.listLatestForEachRecord())
    /**
     * The same one-read-for-the-listing shape, one table over: the entry in
     * force for every ordered pair in the store, sliced per record below. There
     * is no per-retrospective read to make instead — a relation is keyed on two
     * global ids and belongs to no retrospective, which is the point of it.
     */
    const relations = await this.store.recordRelations.listLatestForEachPair()
    /**
     * And the marker beside the lifecycle, read the same way and keyed the same
     * way: who is holding each record right now (`record-claim.model.ts`). One
     * query for the listing, on the standing the lifecycle read above set — and
     * the same read `records.listAll` makes, so the two projections cannot
     * disagree about who has what.
     */
    const claims = claimsByRecord(await this.store.recordClaims.listLatestForEachRecord())
    const records = revision.records
      .map((record) => {
        const view = withLifecycle(
          buildRecordView(
            record,
            requireGlobalId(globalIds, retrospective.id, record.rid),
            revision.n,
            latest.get(record.rid),
          ),
          // Keyed on the pair, never the rid alone: a rid is minted per
          // retrospective, so `r-flaky-test` in two of them is two records.
          lifecycle.get(lifecycleKey(retrospective.id, record.rid)),
          claims.get(lifecycleKey(retrospective.id, record.rid)),
        )
        return withRelations(
          view,
          // Keyed on the global id, which is what a relation names — and on
          // both columns, because the relation reads from both sides.
          relations.filter(
            (entry) => entry.fromId === view.globalId || entry.toId === view.globalId,
          ),
          identities,
        )
      })
      // `state` filters the verdict, which is the only axis a record has since
      // `r-remove-hold`. `hold` is still one of the values it takes: a decision
      // recorded before `r-hold-semantics` can carry one, and human data is
      // never rewritten.
      .filter((view) => input.state === undefined || view.decision.state === input.state)

    return { retroId: retrospective.id, revisionN: revision.n, records }
  }
}
