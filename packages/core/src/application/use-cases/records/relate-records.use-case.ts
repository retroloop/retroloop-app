import { type Clock, timestamp } from '#application/ports/clock.port'
import type { Repositories, Store } from '#application/ports/store.port'
import { parseRecordRelationInput } from '#application/schemas/record-relation-input.schema'
import { requireMinted } from '#application/use-cases/records/minted-record'
import {
  type RecordRelationView,
  recordIdsById,
  resolveRecordRelations,
} from '#application/views/relation.view'
import { ConflictError } from '#domain/errors/conflict.error'
import { ValidationError } from '#domain/errors/validation.error'
import { newDomainEvent } from '#domain/events/domain-event.model'
import type { Actor } from '#domain/models/actor.model'
import type { RecordId } from '#domain/models/record-id.model'
import { latestRelationEntry } from '#domain/services/record-relation.service'

export type RelateRecordsInput = {
  /**
   * **Both actors, with no blanket assert — and that is the feature's first
   * clause.** Both actors can relate records: the AI relates a record it has
   * just filed to the one it is a repeat of, and the human relates two visible
   * on screen. The row records which of them did it.
   *
   * This is therefore the second write in the system that opens without a
   * `ForbiddenActorError.assert`, and unlike `SetRecordLifecycleUseCase` — where
   * two of the four acts are the human's — there is no per-act guard either:
   * relating and un-relating are the same act in both directions, and both of
   * them belong to both actors.
   */
  readonly actor: Actor
  /** The global id of the record the relation is authored **from**. */
  readonly fromId: number
  /** The global id of the record it is authored **to**. */
  readonly toId: number
  /** `true` relates the pair, `false` takes the relation off. Un-relating is a row, never a delete. */
  readonly related: boolean
  /** Required and non-empty when relating, absent when un-relating — the schema enforces both. */
  readonly how?: string
}

export type RelateRecordsOutput = {
  readonly fromId: number
  readonly toId: number
  /** The version just written, 1-based and dense per ordered pair `(fromId, toId)`. */
  readonly version: number
  /**
   * Every relation the **from** record stands in now, both directions, resolved
   * — the same shape and the same fold a read of that record answers with.
   *
   * **Where that leaves the record, not what was written**, which is the shape
   * `records.setLifecycle` and `labels.set` both answer in: a caller that had to
   * take a pair of numbers away and go and look them up would be doing the join
   * every reader of a record already does, and doing it differently.
   */
  readonly relations: readonly RecordRelationView[]
}

/**
 * Two records are related, in the words of whoever relates them — or the
 * relation is taken off. Both actors can relate records, each relation carries
 * how-they-relate words, and the relation reads from both sides, so that the AI
 * can easily find past records and build holistic solutions.
 *
 * **One use case carrying both acts, and one procedure over it.** The precedent
 * is stated in `records.setLifecycle`'s own docstring and is quoted here because
 * this is the call it was written for: *"threads.resolve made the same call with
 * a boolean; this takes the status word instead, because a third position was 'a
 * plausible next ask' when this was written and turned out to be two — the input
 * widened here and the procedure count did not move."* Here the boolean is
 * right, for `record_labels`' reason: relating and un-relating are on and off,
 * and no third position exists for a relation to occupy — a relation that means
 * something else is different *words*, or a different pair. Splitting them would
 * duplicate every guard below to gain a second procedure for the typed mock to
 * cover (R-MOCK-LOCK), which is the cost this repository counts procedures in.
 *
 * **It works on a finished retrospective, and that is the point of the feature.**
 * A relation is written *after* the review closes by construction — the AI
 * relating the record it just filed to the one from three retrospectives ago is
 * the whole of finding past records and building holistic solutions — so this
 * joins `records.setLifecycle`, `labels.apply` and `attributes.set` as a write
 * `refuseWhenFinished` deliberately does not guard, and it is the **fourth**
 * exception in that list. It is safe for the same reason the other three are:
 * **relations are not in the export** (`export.view.ts` carries none), so a
 * document taken from a finished retrospective still cannot change behind its
 * reader. `review.test.ts` enumerates the whole set in one place, and this is
 * named there beside it.
 *
 * **Both records have to be in their retrospective's latest revision**, exactly
 * as one must be to be labelled or resolved. A record a later draft withdrew is
 * not part of the retrospective's outcome, and relating one would write a row
 * pointing at something no page lists. Everything listable is relatable and
 * everything relatable is listable — checked on **both** sides, because this is
 * the one write in the system that names two records.
 *
 * **A record cannot be related to itself.** It is refused here with a sentence
 * before the store is asked anything, and refused again at L1 by the table's own
 * `CHECK (from_id != to_id)` — the same belt-and-braces every human field in this
 * schema has.
 *
 * **A no-op is refused rather than absorbed**, the standing `apply-label` and
 * `LIFECYCLE_ACT_FROM` both set: relating a pair that already stands, or
 * un-relating one that does not, is a caller who believes the store says
 * something it does not.
 *
 * **The relation the other way round is a different pair and is allowed.** `(#5,
 * #12)` and `(#12, #5)` carry two version sequences because they are two
 * statements; refusing the second would be this use case deciding that relations
 * are symmetric, when the words on them are what say whether they are.
 */
export class RelateRecordsUseCase {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}

  async execute(input: RelateRecordsInput): Promise<RelateRecordsOutput> {
    const act = parseRecordRelationInput({ related: input.related, how: input.how })

    /**
     * Above the transaction, for the reason `SetRecordLifecycleUseCase` hoists
     * its actor guard: a caller that has asked for something incoherent is told
     * so before the store is asked anything about it, and no transport can route
     * around it by sending a different payload. Nothing in the store could
     * change the answer — a record is the same record whichever row is read.
     */
    if (input.fromId === input.toId) {
      throw ValidationError.single(
        'toId',
        `record ${input.fromId} cannot be related to itself; a relation names two records`,
      )
    }

    return this.store.tx(async (repositories) => {
      const from = await requireMinted(repositories, input.fromId)
      const to = await requireMinted(repositories, input.toId)

      const entries = await repositories.recordRelations.listForRecord(from.id)
      const previous = latestRelationEntry(entries, from.id, to.id)
      const standing = previous?.applied ?? false
      if (standing === act.related) {
        throw new ConflictError(
          `records #${from.id} and #${to.id} are ${standing ? 'already related' : 'not related'}` +
            (standing && previous !== undefined ? ` — "${previous.how}"` : ''),
        )
      }

      /**
       * The words on the row.
       *
       * Relating carries the caller's; un-relating carries **the words of the
       * relation it takes off**, copied forward here rather than asked for. The
       * column is `NOT NULL` because the words are part of the act by design,
       * and the honest value for an un-relate is the account of the thing being
       * undone — a caller free to supply its own could leave the history holding
       * two disagreeing accounts of one relation, and the act itself has nothing
       * new to say.
       *
       * `previous` cannot be absent on this branch: `standing` is `true` exactly
       * when there is a row, and the conflict above returned for every other
       * case.
       */
      const how = act.related ? act.how : (previous?.how ?? '')

      const at = timestamp(this.clock)
      const written = await repositories.recordRelations.add({
        fromId: from.id,
        toId: to.id,
        version: (previous?.version ?? 0) + 1,
        applied: act.related,
        how,
        actor: input.actor,
        at,
      })

      await repositories.events.append(
        newDomainEvent(
          act.related ? 'RecordRelated' : 'RecordUnrelated',
          at,
          /**
           * Scoped to the **from** record — the record the act was taken on —
           * and carrying no `revisionN`, because a relation outlives every
           * redraft of either record it names (the reasoning every lifecycle and
           * label event gives for having none).
           *
           * One scope for a row that names two records, and the second is in the
           * payload rather than beside it: `EventScope` addresses one
           * retrospective and one rid because that is what every consumer filters
           * on, and a relation that crossed two retrospectives could not be
           * addressed to both without the stream delivering it twice.
           */
          { sessionId: from.sessionId, retroId: from.retroId, rid: from.rid },
          { fromId: from.id, toId: to.id, how, version: written.version },
        ),
      )

      return {
        fromId: from.id,
        toId: to.id,
        version: written.version,
        // Folded from the entries the write just read, through the one function
        // every reader folds with — so the answer a caller gets back is the
        // answer the next read would give it.
        relations: resolveRecordRelations(
          from.id,
          [...entries, written],
          recordIdsById([from, to, ...(await mintedOf(repositories, entries, from.id))]),
        ),
      }
    })
  }
}

/**
 * The pairs behind the other ends of a record's existing relations — everything
 * the answer's `relations` needs and the two the write already resolved do not
 * cover.
 *
 * One lookup per far end, keyed on ids this unit of work is holding, rather than
 * a scan: a record holds a handful of relations, and `record_ids` is insert-only
 * so every one of them names a row.
 */
async function mintedOf(
  repositories: Repositories,
  entries: readonly { readonly fromId: number; readonly toId: number }[],
  recordId: number,
): Promise<readonly RecordId[]> {
  const farIds = new Set<number>()
  for (const entry of entries) {
    farIds.add(entry.fromId === recordId ? entry.toId : entry.fromId)
  }

  const rows: RecordId[] = []
  for (const id of farIds) {
    const minted = await repositories.recordIds.findById(id)
    if (minted !== undefined) rows.push(minted)
  }
  return rows
}
