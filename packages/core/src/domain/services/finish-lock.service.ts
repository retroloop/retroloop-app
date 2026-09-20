import { ConflictError } from '#domain/errors/conflict.error'
import type { Retrospective } from '#domain/models/retrospective.model'

/**
 * A **finished** retrospective takes no more human writing. An export is taken
 * from it, and a document that could grow new feedback behind the reader is a
 * document nobody can cite.
 *
 * What makes one finished is `ReviewClosed`, the AI's close to export — not the
 * human's `ReviewFinished`, which since `r-one-finish-button` closes their
 * side of a round and leaves the retrospective `reviewing`. Between the two they
 * may still write: change a verdict, undo one, add a comment. That window is
 * deliberate, and it is why the close asks the finish gate again rather than
 * trusting the answer it got when the button was pressed.
 *
 * **Every human write path on the *review* calls this.** There were two
 * exceptions for a time — `holds.set` and `holds.clear`, which stayed
 * reachable after a finish because the solving side read the hold long after the
 * review closed (`r-hold-semantics`) — and `r-remove-hold` took
 * the feature out, so those went with it.
 *
 * **What has grown since is a class of write that is not on the review at all**,
 * and each one is here *because* the retrospective is closed:
 *
 * - `records.setLifecycle` — even after a retrospective has been closed,
 *   metadata can be attached to its records so that their life cycle stays
 *   manageable.
 * - `labels.apply` and `attributes.set` — the second usage archetype: on
 *   completion of a retrospective a team may want to move everything into
 *   GitHub right away, and put a label on each record that says 'migrated'.
 *   That labelling happens after the close by construction.
 * - `records.relate` — both actors can relate records, each relation carries
 *   how-they-relate words, and the relation reads from both sides, so that the
 *   AI can easily find past records and build holistic solutions.
 *   It is the most closed-retro-shaped of the four: the record being related
 *   **to** is normally in a retrospective that closed long ago, so a lock
 *   over this would make the feature unreachable in the only case it exists for.
 *
 * None of the four endangers what this lock protects, and the reason is the
 * same for all of them: **none is in the export.** A document taken from a
 * finished retrospective still cannot change behind its reader. That is a
 * standing bargain rather than an accident, and the relation is where it was
 * last paid: relations are kept out of `export.view.ts` *because* a relation can
 * be written after a document was taken, and putting them in would be trading
 * this sentence for a key (`relate-records.use-case.ts`).
 *
 * `review.test.ts` enumerates every human write against a finished
 * retrospective, asserts each one refuses, and names these four beside the list
 * as the deliberate exceptions — a claim about a set is only worth as much as
 * its exceptions being named in the same place.
 */
export function refuseWhenFinished(retrospective: Retrospective, because?: string): void {
  if (retrospective.state !== 'finished') return
  throw new ConflictError(
    because === undefined
      ? `retrospective ${retrospective.id} is finished`
      : `retrospective ${retrospective.id} is finished; ${because}`,
  )
}
