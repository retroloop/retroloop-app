import type { Argv } from 'yargs'
import { readTextInput, sessionRef } from '#args'
import { type CliRuntime, type GlobalOptions, withContext } from '#runtime'

/**
 * `note add` — the AI's friction note, filed as it happens (KC-0015).
 * `note list` — the session's notes back, and with `--with-human` the human's too.
 *
 * The one-way glass is caller protocol, not a mechanism: `--with-human` is for the
 * drafting step and nothing else, and no code here can tell whether the caller is
 * drafting. The skill keeps that discipline; this command only obeys the flag.
 */
export function registerNoteCommand(
  cli: Argv<GlobalOptions>,
  runtime: CliRuntime,
): Argv<GlobalOptions> {
  return cli.command(
    'note <action>',
    'File a friction note, or read the session back',
    (yargs) =>
      yargs
        .positional('action', { choices: ['add', 'list'] as const, describe: 'What to do' })
        .option('session', {
          type: 'string',
          demandOption: true,
          describe: 'Session id or Claude session UUID',
        })
        .option('text', { type: 'string', describe: 'The note, inline' })
        .option('file', { type: 'string', describe: 'Read the note from a file, or - for stdin' })
        .option('kind', {
          choices: ['human-cost', 'ai-cost'] as const,
          default: 'human-cost' as const,
          describe: 'Who the friction costs',
        })
        .option('with-human', {
          type: 'boolean',
          default: false,
          describe: 'list: include human notes and annotations (drafting time only)',
        }),
    async (args) =>
      withContext(runtime, args, async (context) => {
        const session = sessionRef(args.session)

        if (args.action === 'list') {
          const { notes } = await context.app.notes.list.execute({
            actor: 'ai',
            session,
            withHuman: args.withHuman,
          })
          // Which session was read is part of the answer, and an empty list has no
          // row to read it off — so the one case that needs a lookup does one.
          const sessionId =
            notes[0]?.note.sessionId ??
            (await context.app.sessions.get.execute({ actor: 'ai', session })).session.id

          context.output.result(
            {
              sessionId,
              notes: notes.map((view) => ({
                noteId: view.note.id,
                author: view.note.author,
                kind: view.note.kind ?? null,
                text: view.note.text,
                at: view.note.at,
                annotation:
                  view.annotation === undefined
                    ? null
                    : { text: view.annotation.text, at: view.annotation.at },
              })),
            },
            () =>
              notes
                .map(
                  (view) =>
                    `[${view.note.author}] ${view.note.text}${view.annotation === undefined ? '' : `\n    ↳ ${view.annotation.text}`}`,
                )
                .join('\n') || 'No notes.',
          )
          return
        }

        const text = await readTextInput(args, runtime, 'note add')

        const { note } = await context.app.notes.addAi.execute({
          actor: 'ai',
          session,
          text,
          kind: args.kind,
        })

        context.output.result(
          { noteId: note.id, sessionId: note.sessionId, kind: note.kind, at: note.at },
          () => `Noted (${note.kind}) on session ${note.sessionId}`,
        )
      }),
  )
}
