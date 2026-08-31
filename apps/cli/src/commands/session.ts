import type { Argv } from 'yargs'
import { type CliRuntime, type GlobalOptions, withContext } from '#runtime'

/**
 * `session create` — idempotent by the Claude session UUID (cli.md).
 *
 * `--project` is optional (KC-0020): one project routinely holds several
 * software packages, so it was the wrong unit, and `--cwd` — which Claude Code
 * pins for the life of a session — is the identity that survived.
 *
 * The output shape is exactly `{ sessionId, url }` as cli.md specifies. A
 * `created` flag would have been useful for telling a fresh registration from a
 * repeat, but the shape in cli.md is the contract a skill parses, and widening it
 * on my own initiative is how a documented interface stops being documented. The
 * distinction shows in the human-readable line instead.
 */
export function registerSessionCommand(
  cli: Argv<GlobalOptions>,
  runtime: CliRuntime,
): Argv<GlobalOptions> {
  return cli.command(
    'session <action>',
    'Register a session',
    (yargs) =>
      yargs
        .positional('action', {
          choices: ['create'] as const,
          describe: 'What to do',
        })
        .option('claude-session', {
          type: 'string',
          demandOption: true,
          describe: 'Claude session UUID — the idempotency key',
        })
        .option('project', {
          type: 'string',
          describe: 'Project name — optional and dormant; nothing groups or filters by it',
        })
        .option('cwd', { type: 'string', demandOption: true, describe: 'Working directory' })
        .option('branch', { type: 'string', describe: 'Git branch' })
        .option('supervised', {
          type: 'boolean',
          default: false,
          describe: 'Interactive, human-attended session',
        }),
    async (args) =>
      withContext(runtime, args, async (context) => {
        const { session, created } = await context.app.sessions.create.execute({
          actor: 'ai',
          claudeSession: args.claudeSession,
          project: args.project,
          cwd: args.cwd,
          branch: args.branch,
          supervised: args.supervised,
        })

        const url = context.stage.urlForSession(session.id)
        context.output.result({ sessionId: session.id, url }, () =>
          created
            ? `Registered session ${session.id} — ${url}`
            : `Session ${session.id} was already registered — ${url}`,
        )
      }),
  )
}
