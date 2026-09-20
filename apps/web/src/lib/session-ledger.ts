/**
 * The dashboard's ledger: retrospectives gathered into the sittings that
 * produced them.
 *
 * The dashboard used to be a flat list of retrospectives with no time on it at
 * all. It reads as a work diary now — *when* the work happened, and what came
 * out of it — and the session is the unit that reading needs, for two reasons
 * that are both facts about the wire rather than preferences:
 *
 * 1. **The session is the only thing a dashboard row can place in time.**
 *    `retroListRowSchema` carries no retro-level timestamp; the single instant
 *    on the row is `session.startedAt`, served since the schema existed and
 *    rendered nowhere until now. A per-retro time would be a wire widening,
 *    which is a two-package change and out of scope here.
 * 2. **`retroNumber` counts per session.** "Retro #1" is only a true statement
 *    about a retrospective once its session is named beside it — which is why
 *    the identity line always carried both. Grouping puts the session where it
 *    is said once instead of once per row.
 *
 * Pure data, so the ordering is provable without a browser
 * (`test/session-ledger.spec.ts`), which is the layer this belongs at: the
 * arrangement is the whole of the design and a browser would only re-prove it
 * slowly.
 */

/**
 * A session as a dashboard row carries it. Structural rather than imported from
 * the router's output, on `lib/retro-identity.ts`'s precedent: both retro views
 * ship the same session shape, so either satisfies this without narrowing, and
 * the unit test can build one without reaching for the wire's types.
 */
export type SessionStamp = {
  readonly id: number
  readonly cwd: string
  readonly startedAt: string
}

/** One session and the retrospectives it produced, in reading order. */
export type Sitting<Row> = {
  readonly session: SessionStamp
  readonly retros: readonly Row[]
}

/** What `sittings` needs of a row; the rest of it is the caller's business. */
type Placed = {
  readonly retroNumber: number
  readonly session: SessionStamp
}

/**
 * `Date.parse` as a sort key, with an unparseable stamp sorted to the end
 * rather than poisoning the comparator.
 *
 * Every date on the wire is an ISO-8601 instant so this cannot happen through
 * the product — but `NaN` compares false against everything, which makes a
 * comparator that lets one through non-transitive, and a non-transitive
 * comparator does not merely misplace the bad row: it can leave the whole array
 * in an order that depends on the sort's internals. Cheaper to be total.
 */
function startedAtKey(stamp: SessionStamp): number {
  const at = Date.parse(stamp.startedAt)
  return Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at
}

/**
 * Group `rows` by session, newest sitting first, each sitting's retrospectives
 * in the order they happened.
 *
 * **The two orders run opposite ways on purpose.** Sittings descend — the work
 * done last is the work being looked for, and a diary that opened at the
 * beginning of the project would be a diary nobody scrolls. Retrospectives
 * inside a sitting ascend by `retroNumber`, because within one sitting they are
 * a sequence rather than a feed: a chapter reads forward even when the shelf
 * reads backward, and #1 above #2 is the only arrangement in which the numbers
 * are not counting down.
 *
 * Sessions that start at the same instant are broken by id descending, so the
 * result is a total order and two rows can never swap between renders.
 *
 * The session object kept for the group is the first one seen for that id. Every
 * row of a session carries the same `sessionIdentitySchema` value, so there is
 * no choice being made here — only a note that there would be nothing to choose
 * from if there were.
 */
export function sittings<Row extends Placed>(rows: readonly Row[]): readonly Sitting<Row>[] {
  const bySession = new Map<number, { session: SessionStamp; retros: Row[] }>()

  for (const row of rows) {
    const found = bySession.get(row.session.id)
    if (found === undefined) {
      bySession.set(row.session.id, { session: row.session, retros: [row] })
    } else {
      found.retros.push(row)
    }
  }

  return [...bySession.values()]
    .map((group) => ({
      session: group.session,
      retros: [...group.retros].sort((left, right) => left.retroNumber - right.retroNumber),
    }))
    .sort(
      (left, right) =>
        startedAtKey(right.session) - startedAtKey(left.session) ||
        right.session.id - left.session.id,
    )
}
