import { CORE_VERSION } from '@retro/core'
import yargs from 'yargs'
import { registerAttributeCommand } from '#commands/attribute'
import { registerCommentCommand } from '#commands/comment'
import { registerDownCommand } from '#commands/down'
import { registerExportCommand } from '#commands/export'
import { registerLabelCommand } from '#commands/label'
import { registerNoteCommand } from '#commands/note'
import { registerRecordCommand } from '#commands/record'
import { registerReviewCommand } from '#commands/review'
import { registerRevisionCommand } from '#commands/revision'
import { registerServeCommand } from '#commands/serve'
import { registerSessionCommand } from '#commands/session'
import { registerUpCommand } from '#commands/up'
import { EXIT, exitCodeFor, UsageError } from '#errors'
import { createOutput } from '#output'
import { type CliRuntime, createDefaultRuntime } from '#runtime'

/**
 * `--file -` means stdin (cli.md `note add`), but yargs-parser reads a bare `-`
 * as a token in its own right rather than as the option's value, and `--strict`
 * then rejects it as an unknown argument. `--file=-` is the form it does bind, so
 * that is what it gets. Rewriting the pair here keeps the documented spelling
 * working without loosening strict mode, which is what catches real typos.
 */
function bindStdinSentinel(argv: readonly string[]): string[] {
  const normalized: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--file' && argv[index + 1] === '-') {
      normalized.push('--file=-')
      index += 1
      continue
    }
    if (token !== undefined) normalized.push(token)
  }
  return normalized
}

/**
 * The CLI's composition root (architecture.md §Composition roots): it builds the
 * runtime, wires the commands, and turns whatever comes back into an exit code.
 *
 * It **returns** that code rather than calling `process.exit`, which is what lets
 * the whole binary run in-process against a memory store in testing.md's suite 3 —
 * the tests drive the same function the binary does, not a rehearsal of it.
 */
export async function run(
  argv: readonly string[],
  overrides: Partial<CliRuntime> = {},
): Promise<number> {
  const runtime = createDefaultRuntime(overrides)

  // Read before parsing: an argument error still has to be reported in the shape
  // the caller asked for, and by then yargs has nothing to tell us.
  const json = argv.includes('--json')

  const parser = yargs(bindStdinSentinel(argv))
    .scriptName('retroloop')
    .usage('retroloop — local-first retrospectives: AI drafts, human aligns, JSON exports')
    // Never let yargs end the process: this function owns the exit code.
    .exitProcess(false)
    .strict()
    .showHelpOnFail(false)
    .demandCommand(1, 'a command is required')
    .option('json', {
      type: 'boolean',
      default: false,
      describe: 'Machine-readable output on stdout; errors as JSON on stderr',
    })
    .option('home', { type: 'string', describe: 'Retroloop root folder [default: ~/.retroloop]' })
    .option('quiet', { type: 'boolean', default: false, describe: 'Suppress non-essential output' })
    .version(CORE_VERSION)
    .help()
    /**
     * The handler must throw. yargs treats a `fail` handler that returns as
     * "handled" and **carries on into the command** — a missing required option
     * would otherwise run the command with `undefined` in its place. Throwing is
     * what makes a usage error stop anything from happening.
     */
    .fail((message, error) => {
      throw error ?? new UsageError(message)
    })

  registerSessionCommand(parser, runtime)
  registerNoteCommand(parser, runtime)
  registerRevisionCommand(parser, runtime)
  registerRecordCommand(parser, runtime)
  registerCommentCommand(parser, runtime)
  // The AI's transport for the two vocabularies, and the surface the
  // configuration-write switch actually governs. There is no command for
  // putting a label on a record or setting a value: those writes are
  // human-only (`commands/label.ts`).
  registerLabelCommand(parser, runtime)
  registerAttributeCommand(parser, runtime)
  registerReviewCommand(parser, runtime)
  registerExportCommand(parser, runtime)
  registerServeCommand(parser, runtime)
  registerUpCommand(parser, runtime)
  registerDownCommand(parser, runtime)

  try {
    await parser.parseAsync()
    return EXIT.ok
  } catch (error) {
    createOutput({ json, quiet: false, out: runtime.out, err: runtime.err }).failure(error)
    return exitCodeFor(error)
  }
}
