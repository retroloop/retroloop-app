/**
 * A named reader's position in the outbox (realtime.md §The tailer).
 *
 * The one deliberately mutable row in the system: everything else is append-only
 * because it records what happened, while this records only how far someone has
 * got. Overwriting it is the point.
 */
export type Cursor = {
  readonly name: string
  /** The id of the last event this consumer has handled; 0 means "nothing yet". */
  readonly position: number
  readonly updatedAt: string
}

export type CursorRepository = {
  /** `undefined` when this consumer has never recorded a position. */
  find(name: string): Promise<Cursor | undefined>
  /** Creates or moves the cursor. */
  save(cursor: Cursor): Promise<Cursor>
}
