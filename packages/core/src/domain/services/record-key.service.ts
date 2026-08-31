/**
 * The composite key every per-record grouping in this store is built on.
 *
 * A rid is minted **per retrospective** and is not globally unique
 * (`record.model.ts`) — `r-flaky-test` is a plausible slug in two different
 * retrospectives, and a cross-retro listing is exactly where that would first
 * bite. Keying on the rid alone silently shows one record's resolution, or one
 * record's labels, on another's row.
 *
 * It lives on its own because four things now group by it — the lifecycle
 * entries, the label entries, the attribute values, and every reader that folds
 * them onto a flat page. Four copies of a template literal is four chances for
 * one of them to be written `${rid} ${retroId}` and to key correctly against
 * itself and wrongly against the others.
 */
export function recordKey(retroId: number, rid: string): string {
  return `${retroId} ${rid}`
}
