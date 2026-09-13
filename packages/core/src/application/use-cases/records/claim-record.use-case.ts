import { type Clock, timestamp } from '#application/ports/clock.port'
import type { Store } from '#application/ports/store.port'
import { requireMinted } from '#application/use-cases/records/minted-record'
import { ConflictError } from '#domain/errors/conflict.error'
import { newDomainEvent } from '#domain/events/domain-event.model'
import type { Actor } from '#domain/models/actor.model'
import { type EffectiveClaim, effectiveClaim } from '#domain/services/record-claim.service'
import { effectiveLifecycle } from '#domain/services/record-lifecycle.service'
import { effectiveDecision } from '#domain/services/record-state.service'

export type ClaimRecordInput = {
  /**
   * **Both actors, with no assert** — the third write in the system that opens
   * without one, after `records.setLifecycle` and `records.relate`.
   *
   * The AI is who this exists for: it reads the queue and picks a record up. The
   * human may hold one too — he is the other party who does the work, and a
   * marker that could only say "an agent has this" would go up beside a record
   * he is editing himself. The row records which, so nothing is inferred from
   * the table.
   */
  readonly actor: Actor
  /**
   * The record's **global id** — the number `record list` puts first and
   * `/records/:id` carries.
   *
   * It is a number rather than a `(retro, rid)` pair for the reason `relate`
   * takes numbers: the lane crosses retrospectives by construction, and the
   * queue a caller claims out of hands it these numbers and nothing else. It is
   * the only single-column handle a record has (`record-id.model.ts`).
   */
  readonly id: number
  /** `true` takes the record, `false` gives it back. Both are rows. */
  readonly claimed: boolean
}

export type ClaimRecordOutput = {
  readonly recordId: number
  readonly retroId: number
  readonly rid: string
  /** The version just written, 1-based and dense per `(retroId, rid)`. */
  readonly version: number
  /**
   * Where the record stands now — `undefined` after a release, which is the same
   * `undefined` a record nobody ever touched reads as.
   *
   * The standing rather than the row just written, which is the shape
   * `records.setLifecycle` and `records.relate` both answer in: a caller that had
   * to interpret a bit would be doing the fold every reader already does, and
   * doing it differently.
   */
  readonly claim: EffectiveClaim | undefined
}

/**
 * **A record is picked up, or given back** — the in-progress marker the solving
 * lane works out of (`record-claim.model.ts`).
 *
 * Four things it deliberately does, each of them a rule borrowed from a
 * neighbour and one of them a departure:
 *
 * 1. **No actor assert, and no per-act one either.** Unlike
 *    `SetRecordLifecycleUseCase` — where two of four acts are the human's —
 *    taking and releasing are the same act in both directions and both parties
 *    do the work. This is `RelateRecordsUseCase`'s position, for
 *    `RelateRecordsUseCase`'s reason.
 * 2. **No `refuseWhenFinished`.** A claim is *only* interesting after the review
 *    closes: the queue is made of finished retrospectives' approved records, so
 *    a lock on a finished retro would refuse every write this use case has. It
 *    joins `records.setLifecycle`, `labels.apply`, `attributes.set` and
 *    `records.relate` as a write the finish lock does not guard, and it is safe
 *    for their reason: **claims are not exported**, so a document taken from a
 *    finished retrospective still cannot change behind its reader.
 * 3. **A standing that is not `open` is refused.** A resolved record has nothing
 *    left to work on and an archived one is out of the way, so claiming either
 *    is a caller who believes the queue said something it did not — the standing
 *    `LIFECYCLE_ACT_FROM` set. **There is deliberately no verdict requirement**:
 *    the queue only offers approved records, and a marker whose whole job is to
 *    be honest about who is doing what should be able to say so about anything
 *    still open. A `revise` record somebody is rewriting is a true sentence.
 * 4. **A no-op is a `ConflictError`.** Claiming what is already claimed is the
 *    one refusal this feature exists for — two agents, one queue, a minute apart
 *    — and answering "done" to the second would hand them the same record.
 *    Releasing what nobody holds is the same mistake read backwards.
 *
 * **There is no tRPC procedure over it.** The claim is the solving side's, and
 * the review UI reads it as a badge (W3) rather than writing one; the read
 * models carry it, so nothing on the wire has to move for the badge to appear.
 */
export class ClaimRecordUseCase {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}

  async execute(input: ClaimRecordInput): Promise<ClaimRecordOutput> {
    return this.store.tx(async (repositories) => {
      const record = await requireMinted(repositories, input.id)

      /**
       * Where the record stands on the axis that outlives the review, read the
       * way every other reader reads it — through the **effective** verdict, so
       * a declined record is seen as the born-archived one it is
       * (`record-lifecycle.service.ts`) rather than as an untouched open one.
       */
      const revision = await repositories.revisions.findLatestByRetro(record.retroId)
      const stored = revision?.records.find((candidate) => candidate.rid === record.rid)
      if (revision === undefined || stored === undefined) {
        // Unreachable: `requireMinted` just found this record in this revision.
        throw new Error(`record ${input.id} left the latest revision mid-transaction`)
      }
      const verdict = effectiveDecision(
        stored,
        revision.n,
        await repositories.decisions.findLatest(record.retroId, record.rid),
      ).state
      const standing = effectiveLifecycle(
        await repositories.recordLifecycle.findLatest(record.retroId, record.rid),
        verdict,
      ).status

      if (standing !== 'open' && input.claimed) {
        throw new ConflictError(
          `record #${input.id} is ${standing}; only an open record can be claimed`,
        )
      }

      const previous = await repositories.recordClaims.findLatest(record.retroId, record.rid)
      const held = effectiveClaim(previous)
      if ((held !== undefined) === input.claimed) {
        throw new ConflictError(
          held === undefined
            ? `record #${input.id} is not claimed, so there is nothing to release`
            : `record #${input.id} is already claimed at ${held.claimedAt} by ${held.actor}`,
        )
      }

      const at = timestamp(this.clock)
      const written = await repositories.recordClaims.add({
        retroId: record.retroId,
        rid: record.rid,
        version: (previous?.version ?? 0) + 1,
        claimed: input.claimed,
        actor: input.actor,
        at,
      })

      await repositories.events.append(
        newDomainEvent(
          input.claimed ? 'RecordClaimed' : 'RecordUnclaimed',
          at,
          // No `revisionN`, for the reason every lifecycle and label event has
          // none: a claim is on the record, and it outlives every redraft of it.
          { sessionId: record.sessionId, retroId: record.retroId, rid: record.rid },
          { version: written.version, actor: written.actor },
        ),
      )

      return {
        recordId: record.id,
        retroId: record.retroId,
        rid: record.rid,
        version: written.version,
        claim: effectiveClaim(written),
      }
    })
  }
}
