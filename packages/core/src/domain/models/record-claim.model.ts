import type { Actor } from '#domain/models/actor.model'

/**
 * **Somebody is working on this record right now** — the in-progress marker.
 *
 * It exists for the lane: the solving side reads the queue of approved,
 * unresolved records and picks one up, and two agents reading the same queue a
 * minute apart must not both pick up the same record. The claim is what one of
 * them writes and the other one sees.
 *
 * **It is a marker beside the lifecycle axis, never a fourth position on it**
 * (`record-lifecycle.model.ts`). That axis answers *"did we do it"* — `open`,
 * `resolved`, `archived` — and every value on it is a settled fact somebody
 * reported, with references where a claim is being made. "Being worked on" is
 * not settled and reports nothing: it is true for an afternoon and then it is
 * not, and a record that is claimed is still `open` in every sense the lifecycle
 * means. So `RecordLifecycleStatus`, `EffectiveLifecycle`, `LIFECYCLE_ACT_FROM`
 * and the export are untouched by this table, and a reader that wants both
 * carries both.
 *
 * **Either actor may write one**, which it shares with `record_lifecycle` and
 * `record_relations` and with nothing else — and that is why there is an `actor`
 * column. The CLI writes `ai`, because the AI is who picks work up; the column
 * is what lets a human's claim from the browser be representable without a
 * second table. Nothing infers a claim: no commit, no branch, no open record,
 * and no passage of time writes one (KC-0010).
 *
 * **Append-only, and releasing is a row.** "Claimed at 10:00, released at 11:40,
 * claimed again at 14:00" is what somebody asks for when they want to know why a
 * record sat still for a day, and the version sequence is what the next claim
 * numbers itself after — releasing by deleting would make the next claim version
 * 1 again and throw the history away.
 *
 * **A resolve clears the claim**, and it is the one place anything but a claim
 * act writes this table (`set-record-lifecycle.use-case.ts`): the work the claim
 * was about has finished, so leaving the marker up would make every finished
 * record look like it was still being worked on. That is not an inference from
 * silence — it is the same actor, in the same unit of work, saying so.
 */
export type RecordClaimEntry = {
  readonly id: number
  /**
   * The retrospective the record belongs to. Half of the identity: `rid` is
   * minted per retrospective and is **not** globally unique (`record.model.ts`),
   * so `(retroId, rid)` is what addresses a record anywhere in this system — and
   * a claim names one record, which is why this is the pair rather than the
   * global id `record_relations` is keyed on.
   */
  readonly retroId: number
  readonly rid: string
  /** 1-based, dense per `(retroId, rid)`. The highest version is the one in force. */
  readonly version: number
  /**
   * `true` takes the record, `false` gives it back. **Releasing is a row, never
   * a delete** — and a bit rather than a status word, on `record_labels`'
   * argument: held and not-held are on and off, and there is no third position a
   * marker could occupy. Who is holding it is `actor`, which is a column.
   */
  readonly claimed: boolean
  /** Who took it, or gave it back. The AI picks work up; the row records which actor. */
  readonly actor: Actor
  readonly at: string
}

export type NewRecordClaimEntry = Omit<RecordClaimEntry, 'id'>
