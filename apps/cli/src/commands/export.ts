import { writeFileSync } from 'node:fs'
import type { Argv } from 'yargs'
import { retroRef } from '#args'
import { UsageError } from '#errors'
import { type CliRuntime, type GlobalOptions, withContext } from '#runtime'

/**
 * `export` — writes `retro.export.v1`, the public contract user import scripts
 * read (KC-0007).
 *
 * **`--json` means two different things depending on `--out`, and it has to.**
 * cli.md says `--json` prints a receipt `{path, records, bytes}` "instead of the
 * export" — which only makes sense once the export has somewhere to be. With no
 * `--out` there is no path, and printing a receipt would throw the document away.
 * So: with `--out`, `--json` prints the receipt; without `--out`, the export
 * itself goes to stdout, which is already one JSON object on stdout as the global
 * rule requires.
 *
 * **`--project` and `--session --all` are deferred, and not declared here at
 * all.** The v1 envelope describes exactly one retrospective — one `session`, one
 * `retrospective`, `additionalProperties: false` — so a project-wide export
 * cannot conform to it, and the multi-document form is a change to the public
 * contract rather than a detail of this command (cli.md marks both DEFERRED;
 * brief-001 D6 carries the proposed collection envelope).
 *
 * Not declaring them is the point: an undeclared option is rejected by strict
 * mode as an unknown argument, which is true. A stub that accepted the flag and
 * explained itself would be a second, quieter contract — one that says the
 * feature exists somewhere. `commands.test.ts` holds this shut.
 */
export function registerExportCommand(
  cli: Argv<GlobalOptions>,
  runtime: CliRuntime,
): Argv<GlobalOptions> {
  return cli.command(
    'export',
    'Write a retrospective as retro.export.v1 JSON',
    (yargs) =>
      yargs
        .option('retro', { type: 'number', describe: 'Retrospective id' })
        .option('session', {
          type: 'string',
          describe: 'Session id or UUID — exports its finished retrospective',
        })
        .option('state', {
          choices: ['pending', 'approved', 'declined', 'revise', 'hold'] as const,
          describe: 'Only records in this state',
        })
        .option('format', {
          choices: ['json'] as const,
          default: 'json' as const,
          describe: 'Output format',
        })
        .option('out', { type: 'string', describe: 'Write here instead of stdout' }),
    async (args) =>
      withContext(runtime, args, async (context) => {
        const { export: document } = await context.app.exports.retrospective.execute({
          actor: 'ai',
          retro: retroRef(args),
          state: args.state,
        })
        const serialized = `${JSON.stringify(document, null, 2)}\n`

        if (args.out === undefined) {
          runtime.out(serialized.trimEnd())
          return
        }

        try {
          writeFileSync(args.out, serialized)
        } catch (error) {
          throw new UsageError(`cannot write ${args.out}: ${(error as Error).message}`)
        }

        context.output.result(
          {
            path: args.out,
            records: document.records.length,
            bytes: Buffer.byteLength(serialized),
          },
          () => `Exported ${document.records.length} record(s) to ${args.out}`,
        )
      }),
  )
}
