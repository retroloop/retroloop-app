/**
 * Every error the core throws on purpose carries a `code`; each driving adapter
 * maps codes to its own vocabulary (tRPC codes, CLI exit codes). Anything else
 * escaping the core is a bug, not a contract.
 */
export type DomainErrorCode =
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'FORBIDDEN_ACTOR'
  | 'VALIDATION'
  | 'FINISH_GATE'

export abstract class DomainError extends Error {
  abstract readonly code: DomainErrorCode

  /**
   * Public, not `protected`. `abstract` is what stops anyone constructing a
   * `DomainError` itself; `protected` on top of it only made every subclass
   * that adds no constructor of its own uninstantiable from outside — which is
   * a trap, and the reason `ConflictError` used to carry a constructor that
   * did nothing but widen this one (`r-lint-never-silent`).
   */
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

/** True for every error the core throws deliberately. */
export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError
}
