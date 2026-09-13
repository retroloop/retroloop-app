import type { Repositories } from '#application/ports/store.port'
import { NotFoundError } from '#domain/errors/not-found.error'
import type { RecordId } from '#domain/models/record-id.model'

/** A record's global id, the pair it stands for, and the session its retrospective belongs to. */
export type MintedRecord = RecordId & { readonly sessionId: number }

/**
 * The record one global id names — refused if the number was never minted, and
 * refused again if a later draft withdrew the record it names.
 *
 * Both misses are `NotFoundError`, and they are the same miss to a caller: a
 * number that does not name a record of the retrospective as it now stands. The
 * second is the rule `ApplyLabelUseCase` and `SetRecordLifecycleUseCase` apply to
 * the record they touch — everything listable is writable and everything
 * writable is listable — expressed here for the writes that take a **number**
 * rather than a `(retro, rid)` pair.
 *
 * It is shared rather than copied because there are two of those writes now
 * (`relate-records.use-case.ts`, which applies it to each of two records, and
 * `claim-record.use-case.ts`), and the resolution is four reads deep: a second
 * copy is a second chance for one of them to stop checking the latest revision
 * and quietly accept a withdrawn record.
 *
 * It takes `Repositories` rather than the `Store`, so every caller runs it
 * **inside** its own unit of work: the record it resolves has to still be there
 * when the row is written.
 */
export async function requireMinted(repositories: Repositories, id: number): Promise<MintedRecord> {
  const minted = NotFoundError.require(await repositories.recordIds.findById(id), 'record', id)
  const retrospective = NotFoundError.require(
    await repositories.retrospectives.findById(minted.retroId),
    'retrospective',
    minted.retroId,
  )
  const revision = NotFoundError.require(
    await repositories.revisions.findLatestByRetro(minted.retroId),
    'revision',
    'latest',
  )
  NotFoundError.require(
    revision.records.find((candidate) => candidate.rid === minted.rid),
    'record',
    id,
  )
  return { ...minted, sessionId: retrospective.sessionId }
}
