import type { NewThreadResolution, ThreadResolution } from '#domain/models/thread-resolution.model'

/**
 * Human-authored and append-only, exactly like decisions and holds: `add` writes
 * a new version and there is no update or delete on this type. The table's own
 * triggers reject `UPDATE`/`DELETE` as the L1 backstop.
 *
 * Reads come in two shapes because the product asks in two shapes: one thread,
 * for the reply the writer just made, and a page of threads, for every read view
 * that lists them. There is no `listForThread` — nothing shows the history of a
 * resolution, and a method nothing calls is a method every adapter implements
 * twice.
 */
export type ThreadResolutionRepository = {
  add(resolution: NewThreadResolution): Promise<ThreadResolution>
  /** The version in force for the thread, or `undefined` if it was never marked. */
  findLatest(threadId: number): Promise<ThreadResolution | undefined>
  /** The version in force for each of these threads that has one; ascending by thread id. */
  listLatestForThreads(threadIds: readonly number[]): Promise<readonly ThreadResolution[]>
}
