import type { DecisionState } from '#domain/models/decision.model'
import type { EffectiveClaim } from '#domain/services/record-claim.service'
import type { EffectiveLifecycle } from '#domain/services/record-lifecycle.service'
import type { EffectiveDecision } from '#domain/services/record-state.service'

/**
 * **The one word the lane calls a record by**, folded from two axes and the
 * marker beside them — the vocabulary `record list --all --state` filters on and
 * the review UI's badge reads.
 *
 * A record has a verdict (`record-state.service.ts`), a lifecycle
 * (`record-lifecycle.service.ts`) and a claim (`record-claim.service.ts`), and
 * every one of those stays exactly as it is: nothing here is stored, nothing
 * here is a new column, and each of the three axes is still readable on its own
 * wherever the whole truth is wanted. This is the **reading** a person and an
 * agent both actually ask for — *"where is this record?"* — and it lives in one
 * place so the CLI, the read models and the UI badge cannot come to disagree
 * about the answer, the way `retroDisplayState` does one entity up.
 *
 * It is the five verdicts plus the three positions the other two axes add.
 * Every verdict is in the list, which is what lets `record list` and
 * `record list --all` share one `--state` vocabulary instead of carrying two
 * that drift; `hold` is in it for the reason it is in `DecisionState` at all —
 * a decision recorded before `r-hold-semantics` carries one, and human data is
 * never rewritten.
 */
export const LANE_STATES = [
  'pending',
  'approved',
  'declined',
  'revise',
  'hold',
  /** The marker, not a verdict and not a lifecycle position: somebody is on it. */
  'in-progress',
  'resolved',
  'archived',
] as const

export type LaneState = (typeof LANE_STATES)[number]

/**
 * Where a record stands, in one word.
 *
 * **The precedence is the whole of this function**, and each step is a claim
 * about which axis is more interesting when two of them have something to say:
 *
 * 1. **`resolved` wins outright.** The work is done, whatever the verdict said
 *    and whoever was holding it — a claim left up over a resolved record is
 *    stale bookkeeping, not a state (and `records.setLifecycle` clears it in the
 *    same unit of work, so this is a belt to that brace).
 * 2. **`archived` wins next, but only when somebody archived it.**
 *    `lifecycle.actor` is defined exactly when an entry exists, so this branch
 *    is "a human put this out of the way" and nothing else.
 * 3. **Born archived falls through to the verdict.** A declined record is
 *    `archived` with no row saying so (`lifecycle.md`), and calling it
 *    "archived" would throw away the only word that says *why* it is out of the
 *    way. The lane shows `declined`, which is what the human decided.
 * 4. **A claim beats the verdict.** An approved record somebody is holding is
 *    `in-progress`: that is the whole reason the marker exists, and a queue that
 *    called it `approved` would hand it to the next agent as unclaimed work.
 * 5. **Otherwise the verdict shows through**, which is where most records live.
 */
export function laneState(
  decision: EffectiveDecision,
  lifecycle: EffectiveLifecycle,
  claim: EffectiveClaim | undefined,
): LaneState {
  if (lifecycle.status === 'resolved') return 'resolved'
  if (lifecycle.status === 'archived') {
    return lifecycle.actor === undefined ? verdict(decision.state) : 'archived'
  }
  if (claim !== undefined) return 'in-progress'
  return verdict(decision.state)
}

/**
 * A verdict, read as a lane state.
 *
 * The widening is total by construction — `LANE_STATES` opens with the whole of
 * `DecisionState` — and saying so here rather than at each call site is what
 * makes a sixth verdict a compile error in one place instead of a silent
 * widening in three.
 */
function verdict(state: DecisionState): LaneState {
  return state
}
