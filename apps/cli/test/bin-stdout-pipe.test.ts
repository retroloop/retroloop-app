import { afterAll, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp, openSqliteStore } from '@retro/core'
import { aRevisionDraft } from './support/harness'

/**
 * **A `--json` answer reaches a pipe whole, whatever its size** (retro 22
 * `r-cli-json-cut-at-128k-on-pipe`).
 *
 * `bin.ts` ends the process with `process.exit` the moment `run` returns. While
 * the default writer was `process.stdout.write`, anything past the first
 * 131,072 bytes of an answer was still queued when that exit fired, and a reader
 * on a pipe got a document that stopped mid-string — exit 0, nothing on stderr.
 * The in-process suite cannot see this: it injects `out` as a function, so the
 * default writer in `createDefaultRuntime` never runs there.
 *
 * **The pipe has to be a real one between two processes.** The answer is read
 * through `sh -c '… | cat'`, which is how every skill and persona reads the CLI
 * (`retroloop … --json | <reader>`). Reading the child's stdout straight through
 * `Bun.spawn`'s own `stdout: 'pipe'` does *not* show the cut — measured on the
 * unfixed writer, it delivers every byte — so a test written that way is green
 * with the bug present and guards nothing.
 *
 * The same command redirected to a file is the control: a file always got every
 * byte, so piped bytes === file bytes is the property, stated without a magic
 * number. It needs none: this test was red at 131,072 on the asynchronous writer,
 * red again at 65,536 on a single `writeSync` (a short write: one pipe buffer),
 * and red a third time on a loop that did not expect `EAGAIN` from a full pipe —
 * `writeAllSync` in `src/runtime.ts` says what the writer has to do and why.
 *
 * Budgets are explicit, as in `wait-across-processes.test.ts` (retro 7
 * `r-cli-suite-load-fragile`): this file spawns real `bun run` processes and
 * process startup is what stretches on a loaded machine. And every failure
 * message carries the child's stderr, so an early crash does not read as a byte
 * mismatch or a timeout (retro 16 `r-cli-test-swallows-child-stderr`).
 */
const BUDGET_MS = 120_000
const CLEANUP_MS = 30_000

/** The size at which a piped answer used to be cut: 128 KiB. */
const PIPE_CUT_BYTES = 131_072

const BIN = join(import.meta.dir, '../src/bin.ts')

const homes: string[] = []
afterAll(() => {
  for (const dir of homes.splice(0)) rmSync(dir, { recursive: true, force: true })
}, CLEANUP_MS)

/**
 * Authored-looking markdown, every line different, so a cut cannot hide in a run
 * of one byte — and every line carrying a multi-byte character, because the
 * writer resumes a short write at a byte offset and real answers are full of them.
 */
function longDiagnosticData(record: number, lines: number): string {
  return Array.from(
    { length: lines },
    (_, line) =>
      `- **probe ${record}.${line}:** \`wc -c\` on the piped answer — line ${line} of ${lines}.`,
  ).join('\n')
}

/**
 * A real stage holding one revision whose `revision get --json` answer is well
 * past 128 KiB: four records, each with a long `diagnosticData`.
 */
async function seedLargeRevision(): Promise<{ home: string; retroId: number }> {
  const home = mkdtempSync(join(tmpdir(), 'retro-pipe-'))
  homes.push(home)
  const dataDir = join(home, 'data')
  mkdirSync(dataDir, { recursive: true })

  const draft = JSON.parse(
    aRevisionDraft([
      { rid: 'r-large-one', num: 1 },
      { rid: 'r-large-two', num: 2 },
      { rid: 'r-large-three', num: 3 },
      { rid: 'r-large-four', num: 4 },
    ]),
  ) as { records: { num: number; diagnosticData: string }[] }
  for (const record of draft.records) record.diagnosticData = longDiagnosticData(record.num, 900)

  const store = openSqliteStore({ dataDir })
  const app = createApp(store)
  const { session } = await app.sessions.create.execute({
    actor: 'ai',
    claudeSession: 'uuid-stdout-pipe',
    project: 'retro',
    cwd: '/tmp',
  })
  const { retroId } = await app.revisions.create.execute({
    actor: 'ai',
    session: session.id,
    revision: draft as unknown,
  })
  await store.close()

  return { home, retroId }
}

/**
 * Runs `script` under `sh -c` with `args` as `$1…`, so no path is ever spliced
 * into shell text. Both streams are read to the end before the exit is awaited.
 */
async function sh(
  script: string,
  args: readonly string[],
): Promise<{ stdout: Buffer; stderr: string; exitCode: number }> {
  const child = Bun.spawn(['sh', '-c', script, 'sh', ...args], { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
  ])
  return { stdout: Buffer.from(stdout), stderr, exitCode: await child.exited }
}

test(
  'a --json answer over 128 KiB reaches a pipe whole: piped bytes equal file bytes, and parse',
  async () => {
    const { home, retroId } = await seedLargeRevision()
    const filePath = join(home, 'answer.json')
    const command = 'bun run "$1" revision get --retro "$2" --home "$3" --json'

    // The control: the same answer, redirected to a file. No pipe, so `sh`'s
    // exit status is the CLI's own.
    const redirected = await sh(`${command} > "$4"`, [BIN, String(retroId), home, filePath])
    expect(redirected.exitCode, `the file-redirected run failed:\n${redirected.stderr}`).toBe(0)
    const fileBytes = readFileSync(filePath)
    expect(
      fileBytes.length,
      'the seeded answer must be past the old cut, or this test proves nothing',
    ).toBeGreaterThan(PIPE_CUT_BYTES)

    // The read every skill and persona does: through a pipe, to another process.
    const piped = await sh(`${command} | cat`, [BIN, String(retroId), home])
    const stderrOfPiped = `stderr of the piped run:\n${piped.stderr}`

    expect(piped.stdout.length, stderrOfPiped).toBe(fileBytes.length)
    expect(piped.stdout.equals(fileBytes), stderrOfPiped).toBe(true)

    // Whole, not merely long: the last record's body — the end of the document,
    // which is the part a cut takes — comes back exactly as it was seeded.
    const answer = JSON.parse(piped.stdout.toString('utf8')) as {
      records: { num: number; content: { diagnosticData: string } }[]
    }
    expect(answer.records.map((record) => record.num)).toEqual([1, 2, 3, 4])
    expect(answer.records[3]?.content.diagnosticData).toBe(longDiagnosticData(4, 900))
  },
  BUDGET_MS,
)

/**
 * The price of a writer that waits is that it can now *hear* the reader leave: a
 * synchronous write to a closed pipe throws `EPIPE`, where the asynchronous one
 * said nothing. `… --json | head -c 10` is how an agent peeks at an answer, and
 * it must stay what it was — the reader got what it asked for, so exit 0 and a
 * silent stderr, not an `UNKNOWN` error about a broken pipe.
 *
 * The CLI's own exit status is taken inside the pipeline, because `sh` reports
 * only the last command's.
 */
test(
  'a reader that leaves early is not an error: exit 0 and nothing on stderr',
  async () => {
    const { home, retroId } = await seedLargeRevision()
    const stderrPath = join(home, 'peek.stderr')
    const statusPath = join(home, 'peek.status')

    const peek = await sh(
      '{ bun run "$1" revision get --retro "$2" --home "$3" --json 2> "$4"; echo $? > "$5"; } | head -c 10',
      [BIN, String(retroId), home, stderrPath, statusPath],
    )

    const cliStderr = readFileSync(stderrPath, 'utf8')
    expect(peek.stdout.toString('utf8'), `stderr of the CLI:\n${cliStderr}`).toBe('{"retroId"')
    expect(cliStderr).toBe('')
    expect(readFileSync(statusPath, 'utf8').trim(), `stderr of the CLI:\n${cliStderr}`).toBe('0')
  },
  BUDGET_MS,
)

/**
 * The other default writer. `err` moved to fd 2 in the same change, and the
 * in-process suite injects it just as it injects `out` — so this is the one
 * place the real binary's error document is read at all.
 */
test(
  'an error still arrives on stderr as one JSON document, with nothing on stdout',
  async () => {
    const { home, retroId } = await seedLargeRevision()

    const child = await sh('bun run "$1" revision get --retro "$2" --home "$3" --json', [
      BIN,
      String(retroId + 1000),
      home,
    ])

    expect(child.exitCode, `stderr:\n${child.stderr}`).not.toBe(0)
    expect(child.stdout.length, `stderr:\n${child.stderr}`).toBe(0)
    const document = JSON.parse(child.stderr) as { error: { code: string; message: string } }
    expect(typeof document.error.code).toBe('string')
    expect(typeof document.error.message).toBe('string')
  },
  BUDGET_MS,
)
