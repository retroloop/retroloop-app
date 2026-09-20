import { type Clock, timestamp } from '#application/ports/clock.port'
import type { Store } from '#application/ports/store.port'
import { type DecisionInput, parseDecisionInput } from '#application/schemas/decision-input.schema'
import { buildRecordView, type RecordView } from '#application/views/record.view'
import { ForbiddenActorError } from '#domain/errors/forbidden-actor.error'
import { NotFoundError } from '#domain/errors/not-found.error'
import { ValidationError } from '#domain/errors/validation.error'
import { newDomainEvent } from '#domain/events/domain-event.model'
import type { Actor } from '#domain/models/actor.model'
import type { Decision } from '#domain/models/decision.model'
import {
  proposedSolutionLevel,
  type RetroRecord,
  recommendedSolution,
  type SolutionLevel,
} from '#domain/models/record.model'
import { hashRecordContent } from '#domain/services/content-hash.service'
import { refuseWhenFinished } from '#domain/services/finish-lock.service'
import {
  describeRetroRef,
  type RetroRef,
  resolveRetrospective,
  resolveRevision,
} from '#domain/services/reference.service'

export type RecordDecisionInput = {
  readonly actor: Actor
  readonly retro: RetroRef
  readonly rid: string
  /**
   * The revision whose content the human was looking at. Defaults to the
   * latest. A new revision is announced, never swapped in, so a reviewer can
   * still be deciding against revision 1 while revision 2 exists — and their
   * verdict must bind to what they actually read.
   */
  readonly revision?: number
  /**
   * Raw input — `{ state, severity?, solutionLevel?, selectedSolution?,
   * involvement?, reviewerNote? }`.
   */
  readonly decision: unknown
}

export type RecordDecisionOutput = {
  readonly decision: Decision
  readonly record: RecordView
}

/**
 * The two halves of "which solution, and therefore which level", resolved
 * together because on a solutions record they are one answer.
 *
 * **Which record may be sent what.** A record with solutions takes
 * `selectedSolution` and refuses `solutionLevel`: the level is the selected
 * solution's, and a second way to set it would be two answers that can
 * disagree. A record without solutions is the mirror image. Both refusals are
 * loud — silently ignoring a value the human explicitly sent is exactly the
 * quiet inference this product does not do.
 *
 * **The fallback chain is the one the three dials already use** — `input ??
 * previous ?? the AI's proposal` — and the AI's proposal here is the solution it
 * recommended. A reviewer who accepts the recommendation says so by leaving the
 * selection alone and pressing a verdict, which is an explicit act on an
 * explicit value rather than an absence deciding anything.
 *
 * A `previous` selection that is out of range for the array in front of the
 * reviewer is dropped rather than clamped. It can only happen to a decision
 * written against a different set of solutions — which the content hash has
 * already sent back to pending — and pointing at "whichever solution is last
 * now" would be an answer nobody gave.
 */
function chooseSolution(
  record: RetroRecord,
  verdict: DecisionInput,
  previous: Decision | undefined,
): { solutionLevel: SolutionLevel; selectedSolution: number | undefined } {
  if (record.solutions === undefined) {
    if (verdict.selectedSolution !== undefined) {
      throw ValidationError.single(
        'selectedSolution',
        `record ${record.rid} proposes no solutions to select between`,
      )
    }
    return {
      solutionLevel:
        verdict.solutionLevel ?? previous?.solutionLevel ?? record.defaults.solutionLevel,
      selectedSolution: undefined,
    }
  }

  const solutions = record.solutions
  if (verdict.solutionLevel !== undefined) {
    throw ValidationError.single(
      'solutionLevel',
      `the level of record ${record.rid} is the level of the solution selected; send selectedSolution instead`,
    )
  }
  if (verdict.selectedSolution !== undefined && verdict.selectedSolution > solutions.length) {
    throw ValidationError.single(
      'selectedSolution',
      `record ${record.rid} proposes ${solutions.length} solution(s); ${verdict.selectedSolution} is not one of them`,
    )
  }

  const carried =
    previous?.selectedSolution !== undefined && previous.selectedSolution <= solutions.length
      ? previous.selectedSolution
      : undefined
  const selected = verdict.selectedSolution ?? carried ?? recommendedSolution(solutions)
  return {
    solutionLevel: solutions[selected - 1]?.level ?? proposedSolutionLevel(solutions),
    selectedSolution: selected,
  }
}

/**
 * The human's verdict on one record (data-model.md §Decision) — the only place a
 * decision is ever written, and closed to the AI.
 *
 * Append-only: every call writes a new version and no call touches an existing
 * one, so "changed from approved to declined at 14:02" stays readable forever.
 * **Undo is an append too** (`r-verdict-revise`): re-clicking the selected
 * verdict submits `pending`, which writes one more version and leaves the
 * verdict that was undone exactly where it was in the history.

 * The verdict is one of four — pending, approved, declined, revise. `hold` was
 * one until `r-hold-semantics`; a decision row that already carries it is still
 * read, and never rewritten, and nothing writes another. Values the caller
 * leaves out fall back to their previous decision and then to the AI's
 * proposals for that record — never to a state, which is always explicit.
 */
export class RecordDecisionUseCase {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}

  async execute(input: RecordDecisionInput): Promise<RecordDecisionOutput> {
    ForbiddenActorError.assert('human', input.actor, 'deciding a record')
    const verdict = parseDecisionInput(input.decision)

    return this.store.tx(async (repositories) => {
      const retrospective = NotFoundError.require(
        await resolveRetrospective(repositories, input.retro),
        'retrospective',
        describeRetroRef(input.retro),
      )
      refuseWhenFinished(retrospective, 'its decisions are final')

      const revision = NotFoundError.require(
        await resolveRevision(repositories.revisions, retrospective.id, input.revision),
        'revision',
        input.revision ?? 'latest',
      )
      const record = NotFoundError.require(
        revision.records.find((candidate) => candidate.rid === input.rid),
        'record',
        input.rid,
      )

      const previous = await repositories.decisions.findLatest(retrospective.id, record.rid)
      const chosen = chooseSolution(record, verdict, previous)
      const at = timestamp(this.clock)
      const decision = await repositories.decisions.add({
        retroId: retrospective.id,
        rid: record.rid,
        version: (previous?.version ?? 0) + 1,
        state: verdict.state,
        severity: verdict.severity ?? previous?.severity ?? record.defaults.severity,
        solutionLevel: chosen.solutionLevel,
        selectedSolution: chosen.selectedSolution,
        involvement: verdict.involvement ?? previous?.involvement ?? record.defaults.involvement,
        reviewerNote: verdict.reviewerNote ?? previous?.reviewerNote,
        revisionN: revision.n,
        contentHash: hashRecordContent(record),
        decidedAt: at,
      })

      await repositories.events.append(
        newDomainEvent(
          'DecisionRecorded',
          at,
          { retroId: retrospective.id, revisionN: revision.n, rid: record.rid },
          { state: decision.state, version: decision.version },
        ),
      )

      const minted = NotFoundError.require(
        await repositories.recordIds.findByRecord(retrospective.id, record.rid),
        'record number',
        record.rid,
      )
      return { decision, record: buildRecordView(record, minted.id, revision.n, decision) }
    })
  }
}
