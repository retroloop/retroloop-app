import { DomainError, type DomainErrorCode } from '#domain/errors/domain.error'

/**
 * The finish gate (D3): a review may not be finished while any record of the
 * latest revision is effectively pending. Its own code, not a plain conflict,
 * because the UI answers it with the list of undecided records rather than a retry.
 */
export class FinishGateError extends DomainError {
  override readonly code: DomainErrorCode = 'FINISH_GATE'

  constructor(
    readonly retroId: number,
    readonly pendingRids: readonly string[],
  ) {
    super(
      `retrospective ${retroId} still has ${pendingRids.length} pending record(s): ` +
        `${pendingRids.join(', ')}. Every record must be approved or declined.`,
    )
  }
}
