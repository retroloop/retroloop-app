/**
 * A thread marked resolved, or reopened — the human's "I am done with this one"
 * (`r-resolvable-comments`).
 *
 * Only the human may mark a thread, never the AI: the user and only the user
 * marks comments as resolved, and resolved comments appear collapsed. So it is
 * a human field with everything
 * that implies: the AI is refused at the use case and the table's triggers back
 * that up at L1, and reopening writes a new version rather than editing the one
 * that stands.
 *
 * The grain is the **thread**, because that is what the panel shows: a top-level
 * comment *is* a thread, and its replies belong to it.
 *
 * There is no revision here, deliberately, and for the reason a hold has none: a
 * thread outlives every redraft of the record it hangs off — it is keyed on
 * `(retroId, rid, section)` — so "I have dealt with this" does not stop being
 * true because a paragraph was rewritten. What binds to a revision is the
 * comment, not the verdict on the conversation.
 */
export type ThreadResolution = {
  readonly id: number
  readonly threadId: number
  /** 1-based, dense per thread. The highest version is the one in force. */
  readonly version: number
  /** `true` marks it resolved, `false` reopens it. Clearing is a row, never a delete. */
  readonly resolved: boolean
  readonly at: string
}

export type NewThreadResolution = Omit<ThreadResolution, 'id'>
