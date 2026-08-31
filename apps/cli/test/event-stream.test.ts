import { afterEach, describe, expect, test } from 'bun:test'
import { ServerError } from '#errors'
import {
  type RetroEventStreamOptions,
  retroEventStreamUrl,
  subscribeToRetroEvents,
} from '#server/event-stream'
import { type RunningServer, startServer } from '#server/serve'

/**
 * The subscribing half of `review wait --follow`, against a **real socket**.
 *
 * The frames below are not invented: they are the bytes a real `retro serve`
 * put on the wire when this lane measured it (LANE_REPORT §Measurement 1), down
 * to tRPC's trailing blank line. That is what makes this suite a contract with
 * the server rather than with the parser's own idea of SSE — and the real-server
 * scenario in `wait-across-processes.test.ts` is what keeps the two honest, by
 * driving the same code against the actual `events.onRetro`.
 */
const CONNECTED = 'event: connected\ndata: {}\n\n\n'

function tracked(event: {
  id: number
  name: string
  at?: string
  retroId?: number | null
  revisionN?: number | null
  rid?: string | null
}): string {
  const payload = {
    id: event.id,
    name: event.name,
    at: event.at ?? '2026-08-27T11:46:47.953Z',
    retroId: event.retroId ?? 34,
    revisionN: event.revisionN ?? 1,
    rid: event.rid ?? null,
  }
  return `data: ${JSON.stringify(payload)}\nid: ${event.id}\n\n\n`
}

let server: RunningServer | undefined
afterEach(async () => {
  await server?.stop()
  server = undefined
})

/**
 * Serves one SSE response built from the chunks given, then closes the stream —
 * which is exactly what a server going away looks like to the subscriber.
 *
 * **The pause between chunks is load-bearing, and a plant proved it.** Enqueued
 * back to back, all of these arrive at the subscriber as a single read: the
 * frames coalesce before they ever reach the parser, so the scenario that exists
 * to prove a frame split across reads is reassembled was not splitting anything.
 * Planting `buffer = …` where the parser accumulates `buffer += …` left the check
 * green — an inert plant, which is the harness saying the test could not see the
 * defect. With the pause, the same plant fails it. A chunk boundary is not
 * something a test can ask for politely; it has to make the socket idle.
 *
 * `asked` records the request line, so a test can assert what the CLI actually
 * sent rather than what `retroEventStreamUrl` says it would send.
 */
const CHUNK_GAP_MS = 15

function serveFrames(
  chunks: readonly string[],
  options: { readonly status?: number; readonly contentType?: string } = {},
): { origin: string; asked: string[] } {
  const asked: string[] = []
  server = startServer({
    port: 0,
    handler: (request) => {
      asked.push(new URL(request.url).search)
      if (options.status !== undefined && options.status !== 200) {
        return new Response('nope', { status: options.status })
      }
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const encoder = new TextEncoder()
          for (const [index, chunk] of chunks.entries()) {
            if (index > 0) await Bun.sleep(CHUNK_GAP_MS)
            controller.enqueue(encoder.encode(chunk))
          }
          controller.close()
        },
      })
      return new Response(stream, {
        headers: { 'content-type': options.contentType ?? 'text/event-stream' },
      })
    },
  })
  return { origin: `http://127.0.0.1:${server.port}`, asked }
}

async function collect(options: RetroEventStreamOptions): Promise<string[]> {
  const names: string[] = []
  for await (const event of subscribeToRetroEvents(options)) names.push(event.name)
  return names
}

describe('the retro event stream URL', () => {
  test('is the un-batched input form the server answers on', () => {
    const url = retroEventStreamUrl('http://localhost:24100', 34, 812)

    expect(url).toBe(
      `http://localhost:24100/trpc/events.onRetro?input=${encodeURIComponent(
        JSON.stringify({ retroId: 34, lastEventId: '812' }),
      )}`,
    )
  })

  /**
   * `lastEventId` is a **string** on the wire — it is the SSE `Last-Event-ID`,
   * and the procedure parses it with `parseInt`. Sending the number would fail
   * the router's `z.string().nullish()` and the subscription would never open,
   * which the caller would see only as a silent fall back to polling.
   */
  test('sends the cursor as a string, the way the procedure declares it', () => {
    const input = new URL(retroEventStreamUrl('http://x', 1, 0)).searchParams.get('input')

    expect(JSON.parse(input ?? '')).toEqual({ retroId: 1, lastEventId: '0' })
  })
})

describe('subscribeToRetroEvents', () => {
  test('yields the events and skips the connected frame the stream opens with', async () => {
    const { origin } = serveFrames([
      CONNECTED,
      tracked({ id: 4, name: 'DecisionRecorded' }),
      tracked({ id: 5, name: 'ReviewFinished' }),
    ])

    expect(await collect({ origin, retroId: 34, lastEventId: 3 })).toEqual([
      'DecisionRecorded',
      'ReviewFinished',
    ])
  })

  test('asks for the retrospective and the cursor it was given', async () => {
    const { origin, asked } = serveFrames([CONNECTED])

    await collect({ origin, retroId: 34, lastEventId: 812 })

    expect(asked).toHaveLength(1)
    expect(JSON.parse(new URLSearchParams(asked[0]).get('input') ?? '')).toEqual({
      retroId: 34,
      lastEventId: '812',
    })
  })

  /**
   * A frame can arrive split across TCP reads, and one read can carry several.
   * Both are ordinary on a socket and neither is something the caller could see
   * going wrong: a parser that assumed one frame per chunk would drop events
   * under load and look exactly like a slow reviewer.
   */
  test('reassembles a frame split across reads, and splits one read carrying two', async () => {
    const whole = tracked({ id: 9, name: 'ReviewFinished' })
    const { origin } = serveFrames([
      CONNECTED + whole.slice(0, 12),
      whole.slice(12),
      tracked({ id: 10, name: 'ReviewClosed' }) + tracked({ id: 11, name: 'CommentAdded' }),
    ])

    expect(await collect({ origin, retroId: 34, lastEventId: 8 })).toEqual([
      'ReviewFinished',
      'ReviewClosed',
      'CommentAdded',
    ])
  })

  /** Keep-alives and comments are transport noise; the caller must never see them. */
  test('ignores pings and comment lines', async () => {
    const { origin } = serveFrames([
      CONNECTED,
      'event: ping\ndata: \n\n\n',
      ': a comment nobody reads\n\n\n',
      tracked({ id: 5, name: 'ReviewFinished' }),
    ])

    expect(await collect({ origin, retroId: 34, lastEventId: 4 })).toEqual(['ReviewFinished'])
  })

  /**
   * The stream ending is not an error — it is the server going away, and the
   * caller's answer to that is the store, not a failure. So the generator
   * simply finishes and lets `review wait` fall back.
   */
  test('ends quietly when the server closes the stream', async () => {
    const { origin } = serveFrames([CONNECTED, 'event: return\ndata: \n\n\n'])

    expect(await collect({ origin, retroId: 34, lastEventId: 4 })).toEqual([])
  })

  test('raises the error the server serialized into the stream', async () => {
    const { origin } = serveFrames([
      CONNECTED,
      `event: serialized-error\ndata: ${JSON.stringify({ message: 'no such retrospective' })}\n\n\n`,
    ])

    await expect(collect({ origin, retroId: 404, lastEventId: 0 })).rejects.toThrow(ServerError)
  })

  test('refuses a response that is not an event stream', async () => {
    const { origin } = serveFrames([CONNECTED], { contentType: 'application/json' })

    await expect(collect({ origin, retroId: 34, lastEventId: 0 })).rejects.toThrow(ServerError)
  })

  test('refuses a response that is not 200', async () => {
    const { origin } = serveFrames([], { status: 500 })

    await expect(collect({ origin, retroId: 34, lastEventId: 0 })).rejects.toThrow(ServerError)
  })

  /**
   * The payload is validated with `wireEventSchema` — **the server's own**
   * schema, imported from `@retro/api`. A frame the browser would reject is one
   * the CLI rejects too, so the two consumers of this stream cannot drift into
   * disagreeing about what an event is.
   */
  test('refuses a payload the browser’s own schema would refuse', async () => {
    const { origin } = serveFrames([
      CONNECTED,
      'data: {"id":5,"name":"ReviewFinished","at":"now"}\nid: 5\n\n\n',
    ])

    await expect(collect({ origin, retroId: 34, lastEventId: 0 })).rejects.toThrow(ServerError)
  })

  test('stops when the caller aborts, without raising', async () => {
    const controller = new AbortController()
    const { origin } = serveFrames([CONNECTED, tracked({ id: 5, name: 'ReviewFinished' })])

    const seen: string[] = []
    for await (const event of subscribeToRetroEvents({
      origin,
      retroId: 34,
      lastEventId: 0,
      signal: controller.signal,
    })) {
      seen.push(event.name)
      controller.abort()
    }

    expect(seen).toEqual(['ReviewFinished'])
  })

  test('is a server error when nothing is listening at all', async () => {
    // Port 1 is privileged and unbound: connecting fails rather than hanging.
    await expect(
      collect({ origin: 'http://127.0.0.1:1', retroId: 34, lastEventId: 0 }),
    ).rejects.toThrow(ServerError)
  })
})
