import type { Actor } from '#domain/models/actor.model'
import type { RecordId } from '#domain/models/record-id.model'
import type { RecordRelationEntry } from '#domain/models/record-relation.model'
import {
  type RelationDirection,
  relationFrom,
  relationsInForce,
} from '#domain/services/record-relation.service'

/**
 * One relation, read from the side of the record that is being looked at — what
 * the rule that a relation reads from both sides turns into above the store.
 *
 * **It names the other record, never this one.** A reader standing on #5 wants
 * to know about #12; repeating #5 on every line of its own page would be the
 * page telling itself what it already knows. Which of the two the row calls
 * `from` is on `direction` instead, so nothing is lost and one field carries it.
 *
 * **The other record is addressed three ways, and each has a reader.**
 * `globalId` is what a person says out loud and what a URL carries; `(retroId,
 * rid)` is what every read and write in this system is actually addressed by
 * (A5), and that is what makes this block useful: the AI can follow the
 * relation with the same `--retro`/rid arguments every one of its other
 * commands takes, without a second lookup to turn a number back into a pair —
 * which is how it finds past records easily.
 */
export type RecordRelationView = {
  /** The **other** record's number in the whole ledger. */
  readonly globalId: number
  /** And the pair that number stands for — what a follow-up read is addressed by. */
  readonly retroId: number
  readonly rid: string
  /** How they relate, in the words of whoever related them. Never empty. */
  readonly how: string
  /** `outgoing` if this record is the `from` side of the row, `incoming` if it is the `to`. */
  readonly direction: RelationDirection
  /** Who related them — either actor may (`record-relation.model.ts`). */
  readonly actor: Actor
  readonly at: string
}

/**
 * The same relation with the other record's **title** beside its number — the
 * record page's shape, and the record page's alone.
 *
 * A title costs a read of the other record's retrospective, which a page holding
 * one record can afford and a listing holding twenty cannot. The split is the
 * one this product makes everywhere between what a person reads and what a
 * machine follows: a browser reader is being handed a link and needs to know
 * what is at the end of it, while the AI reading `record list --json` is handed
 * an address and goes and gets the record itself.
 */
export type RecordRelationDetail = RecordRelationView & {
  /**
   * The other record's title at its retrospective's latest revision — **or its
   * rid**, when a later draft withdrew it.
   *
   * The fallback is the one the whole web surface already makes for a record
   * with no name to show (D5), and it is honest here for a reason of its own: a
   * rid is a record's name, authored by the AI and stable for the life of the
   * record, and it is the one thing a withdrawn record still has. The relation
   * itself is not hidden — the row was written about a record that existed, and
   * a read that quietly dropped it would be this product inferring something
   * from an absence.
   */
  readonly title: string
}

/**
 * The relations standing on one record, in the order they were authored.
 *
 * `entries` is every row ever written with this record on either side; the fold
 * to what is in force happens here, through the one function every reader folds
 * with, so a page and a write can never disagree about what a record is related
 * to.
 *
 * `identities` maps a global id to the pair it stands for. The caller supplies
 * it because the two readers get it differently and both get it cheaply: the
 * record page resolves the handful of ids it just read, and the revision listing
 * already holds the whole sequence.
 */
export function resolveRecordRelations(
  recordId: number,
  entries: readonly RecordRelationEntry[],
  identities: ReadonlyMap<number, RecordId>,
): readonly RecordRelationView[] {
  const views: RecordRelationView[] = []
  for (const entry of relationsInForce(entries)) {
    const { direction, otherId } = relationFrom(entry, recordId)
    const other = identities.get(otherId)
    /**
     * A number this map does not answer for cannot happen: `record_ids` is
     * insert-only and both sides of every row are foreign keys into it, so an id
     * that reached this table was minted and never moved. It is skipped rather
     * than thrown on because the alternative is a record page that 404s over a
     * line it could have left out — and the store's own constraint is what makes
     * the branch unreachable rather than this check.
     */
    if (other === undefined) continue
    views.push({
      globalId: otherId,
      retroId: other.retroId,
      rid: other.rid,
      how: entry.how,
      direction,
      actor: entry.actor,
      at: entry.at,
    })
  }
  return views
}

/** The pair each global id stands for, keyed by the number — the resolver both readers hand in. */
export function recordIdsById(rows: readonly RecordId[]): ReadonlyMap<number, RecordId> {
  return new Map(rows.map((row) => [row.id, row]))
}
