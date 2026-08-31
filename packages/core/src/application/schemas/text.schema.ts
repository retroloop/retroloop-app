import { z } from 'zod'

/**
 * Free text the human or the AI writes: notes, comments, requests, reviewer notes.
 *
 * Mechanically it is only ever checked for presence. Everything the ledger keeps
 * travels verbatim into the export (D1's reviewer-note rule), so nothing here
 * trims, truncates or reformats what was written — the string is stored as given
 * once it is known to be non-empty.
 */
export const nonEmptyTextSchema = z
  .string()
  .refine((text) => text.trim().length > 0, 'text must not be empty')

export const optionalTextSchema = nonEmptyTextSchema.optional()
