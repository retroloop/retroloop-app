import { DomainError, type DomainErrorCode } from '#domain/errors/domain.error'

export type ValidationIssue = {
  /** Dotted path into the rejected input, e.g. `records.0.rootCause.whys`. */
  readonly path: string
  readonly message: string
}

/**
 * Input rejected at the boundary — the zod schemas (shape, enums, required
 * fields) and the cross-revision checks a schema cannot see (rid/num stability).
 * Only the mechanical rules of D5 land here; authoring *style* stays instructed.
 */
export class ValidationError extends DomainError {
  override readonly code: DomainErrorCode = 'VALIDATION'

  constructor(
    message: string,
    readonly issues: readonly ValidationIssue[] = [],
  ) {
    super(message)
  }

  static single(path: string, message: string): ValidationError {
    return new ValidationError(message, [{ path, message }])
  }
}
