import { DomainError, type DomainErrorCode } from '#domain/errors/domain.error'

/**
 * Repositories return `undefined` for a miss and never throw (repo-layout.md
 * §Conventions). Turning a miss into an error is a use-case decision, made here.
 */
export class NotFoundError extends DomainError {
  override readonly code: DomainErrorCode = 'NOT_FOUND'

  constructor(
    readonly entity: string,
    readonly reference: string | number,
  ) {
    super(`${entity} ${JSON.stringify(reference)} not found`)
  }

  /** Narrows `T | undefined` to `T`, throwing the typed miss otherwise. */
  static require<T>(value: T | undefined, entity: string, reference: string | number): T {
    if (value === undefined) throw new NotFoundError(entity, reference)
    return value
  }
}
