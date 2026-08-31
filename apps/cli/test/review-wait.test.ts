import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EXIT } from '#errors'
import { DEFAULT_BIND } from '#server/address'
import { type RunningServer, startServer } from '#server/serve'
import { aRevisionDraft, type Cli, createCli, removeTempStages } from './support/harness'

afterAll(removeTempStages)

/**
 * `review wait` — the AI blocks until the human says something (realtime.md §CLI
 * waiting). No server is involved: it tails the events table from its own process,
 * so waiting works when nothing is up.
 */
describe('review wait', () => {
  let cli: Cli
  let retroId: number

  beforeEach(async () => {
    cli = createCli()
    const session = await cli.run([
      'session',
      'create',
      '--claude-session',
      'uuid-1',
      '--project',
      'retro',
      '--cwd',
      '/tmp',
      '--json',
    ])
    const sessionId = session.jsonAs<{ sessionId: number }>().sessionId
    const file = cli.file('revision.json', aRevisionDraft())
    const created = await cli.run([
      'revision',
      'create',
      '--session',
      String(sessionId),
      '--file',
      file,
      '--json',
    ])
    retroId = created.jsonAs<{ retroId: number }>().retroId
  })

  async function emit(name: 'ReviewFinished', revisionN: number) {
    await cli.store.events.append({
      name,
      at: '2026-08-23T11:00:00.000Z',
      sessionId: undefined,
      retroId,
      revisionN,
      rid: undefined,
      data: {},
    })
  }

  test('returns the terminating event in the shape cli.md specifies', async () => {
    await emit('ReviewFinished', 1)

    const result = await cli.run(['review', 'wait', '--retro', String(retroId), '--json'])

    expect(result.code).toBe(EXIT.ok)
    expect(result.json()).toEqual({
      kind: 'ReviewFinished',
      retroId,
      revision: 1,
      at: '2026-08-23T11:00:00.000Z',
    })
  })

  test('unblocks when the event arrives while it is waiting', async () => {
    const waiting = cli.run(['review', 'wait', '--retro', String(retroId), '--json'])
    setTimeout(() => void emit('ReviewFinished', 1), 20)

    const result = await waiting

    expect(result.code).toBe(EXIT.ok)
    expect(result.jsonAs<{ kind: string }>().kind).toBe('ReviewFinished')
  })

  test('does not return an outcome that belongs to an earlier revision', async () => {
    // Round one ended with the human finishing it; the AI read what he wrote and
    // answered with revision 2. That old event is not news about the draft now
    // under review, and returning it would send the AI round the loop again on
    // feedback it has already addressed.
    await emit('ReviewFinished', 1)
    const file = cli.file('second.json', aRevisionDraft())
    await cli.run(['revision', 'create', '--session', '1', '--file', file, '--json'])

    // A zero timeout proves it would have blocked: one poll, nothing new, give up.
    const result = await cli.run([
      'review',
      'wait',
      '--retro',
      String(retroId),
      '--timeout',
      '0',
      '--json',
    ])

    expect(result.code).toBe(EXIT.server)
    expect(result.error().code).toBe('TIMEOUT')
  })

  test('sees an outcome for the revision just submitted, even if it arrived first', async () => {
    // The race the cursor exists for: the human finishes between `revision create`
    // and `review wait`. Waiting from "now" would block on an event already past.
    await emit('ReviewFinished', 1)

    const result = await cli.run([
      'review',
      'wait',
      '--retro',
      String(retroId),
      '--timeout',
      '0',
      '--json',
    ])

    expect(result.code).toBe(EXIT.ok)
    expect(result.jsonAs<{ kind: string }>().kind).toBe('ReviewFinished')
  })

  test('is exit 7 when the timeout elapses', async () => {
    const result = await cli.run([
      'review',
      'wait',
      '--retro',
      String(retroId),
      '--timeout',
      '0',
      '--json',
    ])

    expect(result.code).toBe(EXIT.server)
    expect(result.error().message).toContain('timed out')
  })

  test('is exit 3 for a retrospective that does not exist', async () => {
    const result = await cli.run(['review', 'wait', '--retro', '404', '--json'])

    expect(result.code).toBe(EXIT.notFound)
  })

  /**
   * The shape the existing forms answer in is **exactly** cli.md's four keys, and
   * `--follow` is what added a fifth. Asserted by absence here so the new mode
   * cannot quietly widen the contract every script already parses.
   */
  test('answers in four keys and says nothing about how it got there', async () => {
    await emit('ReviewFinished', 1)

    const result = await cli.run(['review', 'wait', '--retro', String(retroId), '--json'])

    expect(Object.keys(result.json()).sort()).toEqual(['at', 'kind', 'retroId', 'revision'])
  })
})

/**
 * `review wait --follow` — the subscribing form (retro 10 `r-monitor-not-realtime`).
 *
 * The record's direction: the CLI receives events **the way the pages do**, over
 * the server's `events.onRetro` stream, and degrades to the store-polling wait
 * when no server is reachable — *"the fallback is the edge, not the norm"*.
 *
 * Two things are worth knowing about what is faked here. The server is a canned
 * SSE responder rather than a real `retro serve`: this is the lowest layer that
 * can express "the command consults the lock, opens the stream, and prefers what
 * it says", and the frames it serves are the bytes a real server was measured
 * putting on the wire. The **real** `events.onRetro` is driven end to end, in
 * three real processes, by `wait-across-processes.test.ts` — that scenario is
 * what proves the format, and this one is what proves the wiring.
 *
 * Every scenario below that expects the stream to answer deliberately leaves the
 * `ReviewFinished` **out of the store**, so a fall back to polling cannot pass
 * for a subscription; and the ones that expect the fallback leave the server
 * unable to answer, so a stream cannot pass for the store.
 */
describe('review wait --follow', () => {
  let cli: Cli
  let retroId: number
  let sessionId: number
  let server: RunningServer | undefined
  let asked: string[] = []

  afterEach(async () => {
    await server?.stop()
    server = undefined
  })

  beforeEach(async () => {
    cli = createCli()
    asked = []
    const session = await cli.run([
      'session',
      'create',
      '--claude-session',
      'uuid-follow',
      '--project',
      'retro',
      '--cwd',
      '/tmp',
      '--json',
    ])
    sessionId = session.jsonAs<{ sessionId: number }>().sessionId
    const file = cli.file('revision.json', aRevisionDraft())
    const created = await cli.run([
      'revision',
      'create',
      '--session',
      String(sessionId),
      '--file',
      file,
      '--json',
    ])
    retroId = created.jsonAs<{ retroId: number }>().retroId
  })

  async function emit(name: 'ReviewFinished', revisionN: number) {
    await cli.store.events.append({
      name,
      at: '2026-08-23T11:00:00.000Z',
      sessionId: undefined,
      retroId,
      revisionN,
      rid: undefined,
      data: {},
    })
  }

  /**
   * Claims the stage the way a running `serve` does. `readLock` refuses a lock
   * whose process is gone, so it has to be this one's pid.
   */
  function claimStage(port: number): void {
    writeFileSync(
      join(cli.dataDir, 'server.lock'),
      JSON.stringify({
        pid: process.pid,
        port,
        bind: DEFAULT_BIND,
        startedAt: '2026-08-27T09:00:00.000Z',
      }),
    )
  }

  /** A server that answers the subscription with the frames given, then closes. */
  function serverEmitting(chunks: readonly string[]): void {
    server = startServer({
      port: 0,
      handler: (request) => {
        asked.push(new URL(request.url).search)
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const encoder = new TextEncoder()
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
            controller.close()
          },
        })
        return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
      },
    })
    claimStage(server.port)
  }

  const CONNECTED = 'event: connected\ndata: {}\n\n\n'
  const finished = (id: number) =>
    `data: ${JSON.stringify({
      id,
      name: 'ReviewFinished',
      at: '2026-08-27T11:46:47.953Z',
      retroId,
      revisionN: 1,
      rid: null,
    })}\nid: ${id}\n\n\n`

  test('takes the finish off the stream, and says the stream is where it came from', async () => {
    // Not in the store: only the subscription can answer this.
    serverEmitting([CONNECTED, finished(9)])

    const result = await cli.run([
      'review',
      'wait',
      '--follow',
      '--retro',
      String(retroId),
      '--timeout',
      '10',
      '--json',
    ])

    expect(result.code).toBe(EXIT.ok)
    expect(result.json()).toEqual({
      kind: 'ReviewFinished',
      retroId,
      revision: 1,
      at: '2026-08-27T11:46:47.953Z',
      via: 'stream',
    })
    expect(asked).toHaveLength(1)
  })

  /**
   * `--session` is a documented alternative to `--retro` on this command
   * (cli.md §Addressing), and the subscription needs the integer id that
   * addressing resolves to — the server's `events.onRetro` takes a `retroId`
   * and nothing else. Getting that wrong would not fail loudly: the CLI would
   * subscribe to somebody else's retrospective, hear nothing, and fall back to
   * polling, which is a correct answer arriving slowly. So the request line is
   * asserted, not just the outcome.
   */
  test('resolves --session to the retrospective it subscribes for', async () => {
    serverEmitting([CONNECTED, finished(9)])

    const result = await cli.run([
      'review',
      'wait',
      '--follow',
      '--session',
      String(sessionId),
      '--timeout',
      '10',
      '--json',
    ])

    expect(result.code).toBe(EXIT.ok)
    expect(result.jsonAs<{ via: string }>().via).toBe('stream')
    expect(asked).toHaveLength(1)
    expect(
      JSON.parse(new URLSearchParams(asked[0]).get('input') ?? '') as { retroId: number },
    ).toMatchObject({ retroId })
  })

  test('waits past the events it does not end on', async () => {
    serverEmitting([
      CONNECTED,
      `data: ${JSON.stringify({
        id: 7,
        name: 'DecisionRecorded',
        at: '2026-08-27T11:46:40.000Z',
        retroId,
        revisionN: 1,
        rid: 'r-stale-lock',
      })}\nid: 7\n\n\n`,
      finished(9),
    ])

    const result = await cli.run([
      'review',
      'wait',
      '--follow',
      '--retro',
      String(retroId),
      '--timeout',
      '10',
      '--json',
    ])

    expect(result.jsonAs<{ kind: string; revision: number }>()).toMatchObject({
      kind: 'ReviewFinished',
      revision: 1,
    })
  })

  test('degrades to the store when no server holds the stage', async () => {
    await emit('ReviewFinished', 1)

    const result = await cli.run([
      'review',
      'wait',
      '--follow',
      '--retro',
      String(retroId),
      '--timeout',
      '10',
      '--json',
    ])

    expect(result.code).toBe(EXIT.ok)
    expect(result.json()).toEqual({
      kind: 'ReviewFinished',
      retroId,
      revision: 1,
      at: '2026-08-23T11:00:00.000Z',
      via: 'store',
    })
  })

  /**
   * The lock outlives nothing here — the pid is alive — but the port answers to
   * nobody, which is what a server killed without releasing its stage looks
   * like. The wait must not fail over it; the store is the source of truth and
   * the stream was only ever a faster route to the same rows.
   */
  test('degrades to the store when the stage’s port answers to nobody', async () => {
    claimStage(1)
    await emit('ReviewFinished', 1)

    const result = await cli.run([
      'review',
      'wait',
      '--follow',
      '--retro',
      String(retroId),
      '--timeout',
      '10',
      '--json',
    ])

    expect(result.code).toBe(EXIT.ok)
    expect(result.jsonAs<{ via: string }>().via).toBe('store')
  })

  test('degrades to the store when the stream opens and then goes away', async () => {
    serverEmitting([CONNECTED])
    await emit('ReviewFinished', 1)

    const result = await cli.run([
      'review',
      'wait',
      '--follow',
      '--retro',
      String(retroId),
      '--timeout',
      '10',
      '--json',
    ])

    expect(result.code).toBe(EXIT.ok)
    expect(asked).toHaveLength(1)
    expect(result.jsonAs<{ via: string }>().via).toBe('store')
  })

  /**
   * `--timeout 0` asks "has he finished yet?", and the store answers that
   * instantly and completely — it is where the rows are. No stream can beat a
   * local read, and one opened for a question already answered would be a
   * connection nobody needed, so the subscribing form stands aside. The
   * assertion that no request was made is the whole point.
   */
  test('does not open a stream for a question the store answers at once', async () => {
    serverEmitting([CONNECTED, finished(9)])
    await emit('ReviewFinished', 1)

    const result = await cli.run([
      'review',
      'wait',
      '--follow',
      '--retro',
      String(retroId),
      '--timeout',
      '0',
      '--json',
    ])

    expect(result.code).toBe(EXIT.ok)
    expect(result.jsonAs<{ via: string }>().via).toBe('store')
    expect(asked).toBeEmpty()
  })

  test('keeps the exit codes the wait already had', async () => {
    serverEmitting([CONNECTED])

    const timedOut = await cli.run([
      'review',
      'wait',
      '--follow',
      '--retro',
      String(retroId),
      '--timeout',
      '0',
      '--json',
    ])
    const missing = await cli.run(['review', 'wait', '--follow', '--retro', '404', '--json'])

    expect(timedOut.code).toBe(EXIT.server)
    expect(timedOut.error().code).toBe('TIMEOUT')
    expect(missing.code).toBe(EXIT.notFound)
  })

  /**
   * The human-readable line says which channel answered, because a person
   * watching a press land is the reader this record exists for: a silent
   * degradation to polling would put the ambiguity back exactly where #112
   * found it.
   */
  test('names the channel in the human line too', async () => {
    serverEmitting([CONNECTED, finished(9)])

    const result = await cli.run([
      'review',
      'wait',
      '--follow',
      '--retro',
      String(retroId),
      '--timeout',
      '10',
    ])

    expect(result.stdout.join('\n')).toContain('live stream')
  })
})
