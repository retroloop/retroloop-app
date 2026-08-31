import { errorCodeFor, messageFor } from '#errors'

/** Where a line goes. Injected so a test reads what the process would have printed. */
export type Writer = (line: string) => void

export type Output = {
  readonly json: boolean
  readonly quiet: boolean
  /** The command's result. In `--json` mode this is the one object on stdout. */
  result(value: unknown, human: () => string): void
  /** Progress and asides — never in `--json` mode, never when `--quiet`. */
  note(line: string): void
  failure(error: unknown): void
}

export type OutputOptions = {
  readonly json: boolean
  readonly quiet: boolean
  readonly out: Writer
  readonly err: Writer
}

/**
 * `--json` everywhere means exactly one JSON object on stdout and nothing else
 * (cli.md §Conventions) — so in JSON mode the human-readable line is not written
 * at all, rather than written somewhere harmless. A skill parsing stdout gets a
 * document, never a document with a friendly sentence glued to it.
 *
 * Errors go to stderr in both modes: `{"error":{"code","message"}}` under
 * `--json`, a plain sentence otherwise.
 */
export function createOutput(options: OutputOptions): Output {
  return {
    json: options.json,
    quiet: options.quiet,
    result(value, human) {
      if (options.json) {
        options.out(JSON.stringify(value))
        return
      }
      if (!options.quiet) options.out(human())
    },
    note(line) {
      if (!options.json && !options.quiet) options.out(line)
    },
    failure(error) {
      if (options.json) {
        options.err(
          JSON.stringify({ error: { code: errorCodeFor(error), message: messageFor(error) } }),
        )
        return
      }
      options.err(`retro: ${messageFor(error)}`)
    },
  }
}

/** Writes through to a stream, one line at a time. */
export function streamWriter(stream: { write(chunk: string): unknown }): Writer {
  return (line) => {
    stream.write(`${line}\n`)
  }
}
