import { isDomainError } from '@retro/core'

/**
 * The exit-code map (cli.md §Exit codes). The CLI's contract with hooks, skills
 * and shell scripts is as much these numbers as it is the JSON, so the mapping
 * lives in one place and is covered test-by-test.
 */
export const EXIT = {
  ok: 0,
  /** Genuinely unclassified — a bug, not a condition anyone can act on. */
  unclassified: 1,
  usage: 2,
  notFound: 3,
  conflict: 4,
  forbidden: 5,
  pendingMigrations: 6,
  server: 7,
} as const

/** Bad arguments, or input that failed validation before anything was written. */
export class UsageError extends Error {
  readonly code = 'USAGE'
}

/** The server could not be reached, started, or is already running (exit 7). */
export class ServerError extends Error {
  readonly code: string = 'SERVER'
}

/** `review wait --timeout` elapsed — exit 7, with its own code so a script can tell. */
export class TimeoutError extends ServerError {
  override readonly code: string = 'TIMEOUT'
}

export function exitCodeFor(error: unknown): number {
  if (error instanceof UsageError) return EXIT.usage
  if (error instanceof ServerError) return EXIT.server

  if (isDomainError(error)) {
    switch (error.code) {
      case 'NOT_FOUND':
        return EXIT.notFound
      case 'CONFLICT':
        return EXIT.conflict
      case 'FORBIDDEN_ACTOR':
        return EXIT.forbidden
      /**
       * Validation is exit 2, with usage. cli.md does not pin it; a revision file
       * that fails the schema is the caller having handed us bad input, which is
       * exactly what "usage" means. Exit 1 stays reserved for failures nobody
       * anticipated, so a script can tell "I sent something wrong" from "something
       * broke".
       */
      case 'VALIDATION':
        return EXIT.usage
      /**
       * The finish gate is a refusal to act on the state as it stands — a
       * conflict. `review close` reaches it: the reviewer can undo a verdict
       * after finishing, and the AI must not close a review over a record that
       * went back to pending.
       */
      case 'FINISH_GATE':
        return EXIT.conflict
    }
  }

  return EXIT.unclassified
}

/** The `code` reported in `{"error":{"code","message"}}`. */
export function errorCodeFor(error: unknown): string {
  if (error instanceof UsageError || error instanceof ServerError) return error.code
  if (isDomainError(error)) return error.code
  return 'UNKNOWN'
}

export function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
