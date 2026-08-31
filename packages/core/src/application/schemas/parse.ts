import type { z } from 'zod'
import { ValidationError } from '#domain/errors/validation.error'

/**
 * The one place a zod failure becomes a domain error. Inputs are validated once,
 * at the boundary (repo-layout.md §Conventions); everything below a use case's
 * `execute` may trust its types.
 */
export function parseOrThrow<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
  what: string,
): z.output<Schema> {
  const result = schema.safeParse(input)
  if (result.success) return result.data

  const issues = result.error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }))
  const first = issues[0]
  const summary =
    first === undefined ? what : `${what}: ${first.path || '(root)'} — ${first.message}`
  throw new ValidationError(
    issues.length > 1 ? `${summary} (+${issues.length - 1} more)` : summary,
    issues,
  )
}
