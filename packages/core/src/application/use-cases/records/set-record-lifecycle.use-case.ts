import { type Clock, timestamp } from '#application/ports/clock.port'
import type { Store } from '#application/ports/store.port'
import { parseRecordLifecycleInput } from '#application/schemas/record-lifecycle-input.schema'
import { ConflictError } from '#domain/errors/conflict.error'
import { ForbiddenActorError } from '#domain/errors/forbidden-actor.error'
import { NotFoundError } from '#domain/errors/not-found.error'
import { type EventName, newDomainEvent } from '#domain/events/domain-event.model'
import type { Actor } from '#domain/models/actor.model'
import type {
  RecordLifecycleState,
  RecordLifecycleStatus,
} from '#domain/models/record-lifecycle.model'
import { effectiveClaim } from '#domain/services/record-claim.service'
import {
  type EffectiveLifecycle,
  effectiveLifecycle,
  LIFECYCLE_ACT_FROM,
  lifecycleActIsHumanOnly,
  lifecycleActPermitted,
} from '#domain/services/record-lifecycle.service'
import { effectiveDecision } from '#domain/services/record-state.service'
import {
  describeRetroRef,
  type RetroRef,
  resolveRetrospective,
} from '#domain/services/reference.service'

export type SetRecordLifecycleInput = {
  /**
   * **Both actors on two of the four acts, and that is the feature.** Every
   * other append-only table in this system is single-writer and asserts so on
   * its first line; this one is written by the AI resolving what it just fixed
   * and by the human resolving from the browser, and the row records which.
   *
   * Archiving and unarchiving are the human's alone, enforced at the top of
   * `execute` rather than at any transport.
   */
  readonly actor: Actor
  readonly retro: RetroRef
  readonly rid: string
  readonly status: RecordLifecycleStatus
  /** Required and non-empty on a resolve, absent on every other act — the schema enforces both. */
  readonly refs?: readonly string[]
  readonly note?: string
}

export type SetRecordLifecycleOutput = {
  readonly retroId: number
  readonly rid: string
  /** The version just written, 1-based and dense per `(retroId, rid)`. */
  readonly version: number
  /** Where the record stands now — the entry just written, read as a state. */
  readonly lifecycle: EffectiveLifecycle
}

/**
 * A record is marked resolved, reopened, archived or unarchived. Once the AI
 * fixes an issue there has to be a way to show that it was resolved, citing a
 * commit id, a GitHub issue or something like it as reference so that the fix is
 * easy to see. `archived` sits beside that: a record can be archived and
 * unarchived again, and every approved record that is not archived is a normal
 * record.
 *
 * Four things this deliberately does **not** do, each of them a rule somewhere
 * else in the product that does not apply here:
 *
 * 1. **No blanket actor assert.** `ResolveThreadUseCase` opens with one for the
 *    whole use case and this does not, which is the single largest departure in
 *    this feature. The holds and thread-resolution tables are the human's
 *    verdict on the AI's work, so the AI is refused outright; resolving is a
 *    report of work done, and the AI is the one who does it. The guard is
 *    therefore **per act**: it fires on `archived` and `unarchived`, which are
 *    judgments about what is worth looking at, and on neither of the other two.
 * 2. **No `refuseWhenFinished`.** A finished retrospective refuses every human
 *    write in the product, and this is the exception the doctrine already
 *    anticipated (`finish-lock.service.ts` names the two `holds` procedures that
 *    held the same position). It has to be: the feature exists *because* the
 *    retrospective is closed — even after a retrospective has been closed,
 *    metadata can be attached to its records so their lifecycle can be managed.
 *    The export is not endangered by it, because lifecycle is not exported
 *    (A8): a document taken from a finished retrospective still cannot change
 *    behind its reader.
 * 3. **Nothing is inferred, and nothing is written at close.** Every
 *    row here is this call, made by a named actor; no commit message, no merge,
 *    no review close writes one. A declined record reads as `archived` with no
 *    row at all — that is `effectiveLifecycle` reading a verdict the human gave,
 *    not this use case writing an act nobody took.
 * 4. **No update and no delete.** Every act appends a version, so "resolved on
 *    the 29th citing abc123, archived on the 30th" is readable forever — the
 *    same shape a declined record has, where decline is a state rather than a
 *    deletion. Archiving in particular is not a delete and never becomes one:
 *    the discussion is the thing archiving exists to keep.
 *
 * **Transitions are checked, and a bad one is a `ConflictError`** rather than a
 * silent no-op — the standing that reopening-what-was-never-resolved set.
 * Answering "done" to an act that did nothing is the quiet inference this
 * product refuses everywhere else: the caller believed the store said something
 * it did not. `LIFECYCLE_ACT_FROM` is the table; the check needs the record's
 * verdict as well as its entries, because where a record with no entries stands
 * depends on it.
 */
export class SetRecordLifecycleUseCase {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}

  async execute(input: SetRecordLifecycleInput): Promise<SetRecordLifecycleOutput> {
    const entry = parseRecordLifecycleInput({
      status: input.status,
      refs: input.refs,
      note: input.note,
    })

    /**
     * **The actor rule, per act, above everything else.** Archiving and
     * unarchiving are the human's — the user archives a record if they want to,
     * and unarchives it again — and this is the guard `ResolveThreadUseCase`
     * opens with, applied to two of this use case's four acts rather than to
     * all of them. It sits here, above the transaction, for the reason that one
     * sits above its first read: an actor who may not do a thing is told so
     * before the store is asked anything about it, and no transport can route
     * around it by sending a different payload.
     */
    if (lifecycleActIsHumanOnly(entry.status)) {
      ForbiddenActorError.assert('human', input.actor, `marking a record ${entry.status}`)
    }

    return this.store.tx(async (repositories) => {
      const retrospective = NotFoundError.require(
        await resolveRetrospective(repositories, input.retro),
        'retrospective',
        describeRetroRef(input.retro),
      )

      /**
       * The record has to be in the **latest** revision, which is the same
       * revision `records.listAll` lists and the export exports. A record a
       * later draft withdrew is not part of the retrospective's outcome, and
       * resolving one would write a row nothing displays — everything
       * resolvable is listable, and everything listable is resolvable.
       */
      const revision = NotFoundError.require(
        await repositories.revisions.findLatestByRetro(retrospective.id),
        'revision',
        'latest',
      )
      const record = NotFoundError.require(
        revision.records.find((candidate) => candidate.rid === input.rid),
        'record',
        input.rid,
      )

      const previous = await repositories.recordLifecycle.findLatest(retrospective.id, record.rid)

      /**
       * **Where the record stands now, which needs the verdict.** A record with
       * no entry at all is `open` — unless it was declined, in which case it is
       * `archived` from birth and nobody wrote a row saying so
       * (`record-lifecycle.service.ts`). So the transition check cannot be made
       * from the lifecycle table alone: unarchiving a declined record is a legal
       * first act, and archiving one is not.
       *
       * The verdict is read the way every other reader reads it — through
       * `effectiveDecision`, against the record in the latest revision — so this
       * use case can never disagree with what `records.listAll` shows on the
       * same row.
       */
      const verdict = effectiveDecision(
        record,
        revision.n,
        await repositories.decisions.findLatest(retrospective.id, record.rid),
      ).state
      const standing = effectiveLifecycle(previous, verdict).status

      if (!lifecycleActPermitted(entry.status, standing)) {
        throw new ConflictError(
          refusal(retrospective.id, record.rid, entry.status, standing, previous === undefined),
        )
      }

      const at = timestamp(this.clock)
      const written = await repositories.recordLifecycle.add({
        retroId: retrospective.id,
        rid: record.rid,
        version: (previous?.version ?? 0) + 1,
        status: entry.status,
        refs: entry.refs ?? [],
        note: entry.note,
        actor: input.actor,
        at,
      })

      await repositories.events.append(
        newDomainEvent(
          EVENT_OF_ACT[entry.status],
          at,
          // No `revisionN`, for the reason a thread resolution has none: a
          // record's lifecycle outlives every redraft of it, and the fix landed
          // against the retrospective rather than against a draft of it.
          { sessionId: retrospective.sessionId, retroId: retrospective.id, rid: record.rid },
          { version: written.version, actor: written.actor },
        ),
      )

      /**
       * **The resolve takes the in-progress marker down**, and it is the one
       * place outside `records.claim` that writes that table
       * (`record-claim.model.ts`).
       *
       * The work the claim was about has finished, so leaving the marker
       * standing would make every resolved record read as still being worked on
       * — and the next agent scanning the lane would skip work nobody is doing.
       *
       * **This is not an inference from silence**, which is the rule it
       * has to answer to: nothing here reads a commit, a close or the passage of
       * time. It is the same actor, in the same unit of work, at the same
       * instant, saying that they finished — and the row it writes says so, with
       * their name on it.
       *
       * **Only the resolve.** A reopen does not hand the record back to whoever
       * had it (picking it up again is a claim, and somebody has to make it), and
       * an archive says nothing about who was working on the record — the human
       * putting a record out of the way is not a statement about the agent that
       * holds it.
       */
      if (entry.status === 'resolved') {
        const claim = await repositories.recordClaims.findLatest(retrospective.id, record.rid)
        if (effectiveClaim(claim) !== undefined && claim !== undefined) {
          const released = await repositories.recordClaims.add({
            retroId: retrospective.id,
            rid: record.rid,
            version: claim.version + 1,
            claimed: false,
            actor: input.actor,
            at,
          })
          await repositories.events.append(
            newDomainEvent(
              'RecordUnclaimed',
              at,
              { sessionId: retrospective.sessionId, retroId: retrospective.id, rid: record.rid },
              { version: released.version, actor: released.actor },
            ),
          )
        }
      }

      return {
        retroId: retrospective.id,
        rid: record.rid,
        version: written.version,
        lifecycle: effectiveLifecycle(written, verdict),
      }
    })
  }
}

/**
 * One event name per act, so a consumer reads the name rather than the payload —
 * the rule `HoldSet`/`HoldCleared` set and `ThreadResolved`/`ThreadReopened`
 * kept. All four carry the same scope and the same data as `RecordResolved`
 * always did, and none of them carries a `revisionN`: a record's lifecycle
 * outlives every redraft of it.
 */
const EVENT_OF_ACT = {
  resolved: 'RecordResolved',
  reopened: 'RecordReopened',
  archived: 'RecordArchived',
  unarchived: 'RecordUnarchived',
} as const satisfies Record<RecordLifecycleStatus, EventName>

/**
 * Why the act was refused, in the reader's terms: where the record actually
 * stands, and where it would have had to stand.
 *
 * The never-resolved case keeps a sentence of its own, because it is the one
 * refusal whose cause is an absence rather than a state — "this record is open"
 * is true and unhelpful when what happened is that nobody has ever touched it.
 */
function refusal(
  retroId: number,
  rid: string,
  act: RecordLifecycleStatus,
  standing: RecordLifecycleState,
  untouched: boolean,
): string {
  if (act === 'reopened' && untouched) {
    return `record ${rid} of retrospective ${retroId} has never been resolved, so there is nothing to reopen`
  }
  return (
    `record ${rid} of retrospective ${retroId} is ${standing}, ` +
    `and a record can only be marked ${act} while it is ${LIFECYCLE_ACT_FROM[act].join(' or ')}`
  )
}
