import { type CommentTarget, RECORD_SECTIONS, type RecordSection } from '@retro/core'
import type { Argv } from 'yargs'
import { readTextInput, retroRef } from '#args'
import { UsageError } from '#errors'
import { type CliRuntime, type GlobalOptions, withContext } from '#runtime'
import { threadJson } from '#views'

/**
 * `comment list` and `comment add` — the AI's half of a thread.
 *
 * The CLI writes as the AI and only as the AI: human comments are UI-only and
 * immutable (D4), so there is no `--actor` here to get wrong.
 *
 * `--section` takes D8's eight sections, imported from the core enum rather than
 * spelled out again — cli.md's own inline list predates D8 and names sections
 * (`impact`, `chain`, `agreed_direction`) the model does not have. The enum is the
 * authority, and `--help` shows what the model will actually accept.
 *
 * **Three targets, because the store has three** (`r-cli-review-thread-reply`).
 * `--record --section` was once the only one, so review-level asks had no
 * sanctioned answer and the reply detoured through chat — the exact smuggling
 * review-level threads were built to end. `--thread <id>` answers a thread that
 * already exists, review-level or record-level, which is what answering where
 * the question was asked needs; `--review` opens a new one anchored to nothing.
 */
type CommentArgs = {
  readonly record?: string
  readonly section?: RecordSection
  readonly thread?: number
  readonly review: boolean
}

/**
 * Which thread the reply goes into — one mode, named explicitly.
 *
 * Nothing is inferred from an absent `--record`: a bare `comment add` is far more
 * likely to be a forgotten flag than a deliberate review-level thread, and
 * guessing would open a thread nobody asked for instead of returning exit 2.
 */
function commentTarget(args: CommentArgs): CommentTarget {
  const modes = [args.thread !== undefined, args.review, args.record !== undefined].filter(Boolean)
  if (modes.length === 0) {
    throw new UsageError(
      'comment add needs --thread <id>, --review, or --record <rid> --section <name>',
    )
  }
  if (modes.length > 1) {
    throw new UsageError('comment add takes one of --thread, --review or --record, not several')
  }

  if (args.thread !== undefined) return { kind: 'thread', threadId: args.thread }
  if (args.review) {
    if (args.section !== undefined) {
      throw new UsageError('a review-level thread hangs off no record, so it takes no --section')
    }
    return { kind: 'review' }
  }
  if (args.section === undefined) throw new UsageError('comment add --record needs --section')
  return { kind: 'record', rid: args.record as string, section: args.section }
}
export function registerCommentCommand(
  cli: Argv<GlobalOptions>,
  runtime: CliRuntime,
): Argv<GlobalOptions> {
  return cli.command(
    'comment <action>',
    'Read the review’s threads, or reply in one',
    (yargs) =>
      yargs
        .positional('action', { choices: ['list', 'add'] as const, describe: 'What to do' })
        .option('retro', { type: 'number', describe: 'Retrospective id' })
        .option('session', { type: 'string', describe: 'Session id or UUID (its active retro)' })
        .option('record', {
          type: 'string',
          describe: 'add: the record whose section thread to write in; list: filter to one record',
        })
        .option('section', {
          choices: RECORD_SECTIONS,
          describe: 'add: which section of the record the thread hangs off',
        })
        .option('thread', {
          type: 'number',
          describe: 'add: reply in this existing thread, review-level or record-level',
        })
        .option('review', {
          type: 'boolean',
          default: false,
          describe: 'add: open a new review-level thread, anchored to no record',
        })
        .option('text', { type: 'string', describe: 'add: the reply, inline' })
        .option('file', { type: 'string', describe: 'add: read the reply from a file, or -' })
        .option('unanswered', {
          type: 'boolean',
          default: false,
          describe: 'list: only threads whose last message is the human’s',
        }),
    async (args) =>
      withContext(runtime, args, async (context) => {
        const retro = retroRef(args)

        if (args.action === 'list') {
          const { retroId, threads } = await context.app.threads.list.execute({
            actor: 'ai',
            retro,
            rid: args.record,
            unansweredOnly: args.unanswered,
          })

          context.output.result(
            { retroId, threads: threads.map(threadJson) },
            () =>
              threads
                .map(
                  (thread) =>
                    `#${thread.id} ${thread.rid ?? '(review)'} · ${thread.section ?? '—'}${
                      thread.resolved ? ' · resolved' : ''
                    } — ${thread.messages.length} message(s), last from ${thread.messages.at(-1)?.actor ?? 'nobody'}`,
                )
                .join('\n') || 'No threads.',
          )
          return
        }

        const target = commentTarget(args)
        const text = await readTextInput(args, runtime, 'comment add')

        const { thread } = await context.app.threads.addComment.execute({
          actor: 'ai',
          retro,
          target,
          text,
        })
        // Append-only: the reply the AI just wrote is the last message, always.
        const written = thread.messages.at(-1)

        context.output.result(
          {
            retroId: thread.retroId,
            threadId: thread.id,
            rid: thread.rid ?? null,
            section: thread.section ?? null,
            commentId: written?.id ?? null,
            at: written?.at ?? null,
            // Which draft the reply was recorded against — the AI's own
            // comments are stamped with the latest revision, because there is
            // no `--revision` here and nothing is inferred from an absent flag.
            revision: written?.revision ?? null,
          },
          () =>
            `Replied in thread #${thread.id} (${thread.rid ?? 'review'}${
              thread.section === undefined ? '' : ` · ${thread.section}`
            })`,
        )
      }),
  )
}
