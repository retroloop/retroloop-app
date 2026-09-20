import { readFileSync } from 'node:fs'
import type { RetroRef, SessionRef } from '@retro/core'
import { UsageError } from '#errors'
import type { CliRuntime } from '#runtime'

/**
 * `--session <id|uuid>` (cli.md §Addressing). A string of digits is the integer
 * id; anything else is the Claude session UUID. Deciding here means every command
 * addresses a session the same way.
 */
export function sessionRef(value: string): SessionRef {
  const trimmed = value.trim()
  return /^\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : trimmed
}

/**
 * `--retro <id>` is the primary address; `--session` means its active retrospective.
 *
 * `known` is the retrospective a `#globalId` positional has already named —
 * `record resolve 194` (`r-brief-record-resolve-line`). Then neither flag is
 * required: a `--retro` is accepted when it agrees and refused when it does not,
 * and a `--session` is refused outright. A rid is minted per retrospective and
 * is not unique across them, so a flag naming a different retrospective than the
 * number does is the caller holding two records in mind, and passing it through
 * could land the act on a same-named record elsewhere.
 */
export function retroRef(
  args: { readonly retro?: number; readonly session?: string },
  known?: { readonly retroId: number; readonly namedBy: string },
): RetroRef {
  if (known !== undefined) {
    if (args.session !== undefined) {
      throw new UsageError(
        `--session is not taken beside ${known.namedBy}: the number names its retrospective on its own`,
      )
    }
    if (args.retro !== undefined && args.retro !== known.retroId) {
      throw new UsageError(
        `--retro ${args.retro} disagrees with ${known.namedBy}, which is in retrospective ${known.retroId}`,
      )
    }
    return { retroId: known.retroId }
  }
  if (args.retro !== undefined) return { retroId: args.retro }
  if (args.session !== undefined) return { session: sessionRef(args.session) }
  throw new UsageError('one of --retro or --session is required')
}

/**
 * Body text from `--text`, or from `--file` (with `-` for stdin), per cli.md's
 * `note add`. A missing file is a usage error, not an unclassified crash: the
 * caller pointed at something that is not there.
 */
export async function readTextInput(
  args: { readonly text?: string; readonly file?: string },
  runtime: CliRuntime,
  what: string,
): Promise<string> {
  if (args.text !== undefined) return args.text
  if (args.file === undefined) throw new UsageError(`${what} needs --text or --file`)
  if (args.file === '-') return runtime.stdin()

  try {
    return readFileSync(args.file, 'utf8')
  } catch {
    throw new UsageError(`cannot read ${args.file}`)
  }
}

export function parseJsonInput(text: string, what: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new UsageError(`${what} is not valid JSON: ${(error as Error).message}`)
  }
}
