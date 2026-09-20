import { type WireEvent, wireEventSchema } from '@retro/api'
import { ServerError } from '#errors'

/** The one subscription the server offers (`events.router.ts`). */
export const RETRO_EVENTS_PATH = '/trpc/events.onRetro'

export type RetroEventStreamOptions = {
  /** `http://host:port` of the running server — `localOriginFor` builds it. */
  readonly origin: string
  readonly retroId: number
  /**
   * Where to resume from, exclusive. `review wait` passes the id of the latest
   * `RevisionCreated`, which is the same cursor the polling wait starts at — so
   * a finish that landed before the subscription opened arrives in the replay
   * rather than being missed.
   */
  readonly lastEventId: number
  readonly signal?: AbortSignal
}

/**
 * The URL a browser's `httpSubscriptionLink` would open, written out.
 *
 * **Un-batched `?input=`**, and `lastEventId` as a **string**: the procedure
 * declares `z.string().nullish()` and parses it with `parseInt`, so a number
 * there fails validation and the subscription never opens — a failure the caller
 * would only ever see as a silent fall back to polling. Measured against a real
 * `retro serve` rather than recalled.
 */
export function retroEventStreamUrl(origin: string, retroId: number, lastEventId: number): string {
  const input = encodeURIComponent(JSON.stringify({ retroId, lastEventId: String(lastEventId) }))
  return `${origin}${RETRO_EVENTS_PATH}?input=${input}`
}

/** tRPC's own SSE control frames (`sseStreamProducer`). None of them is an event. */
const CONNECTED = 'connected'
const PING = 'ping'
const RETURN = 'return'
const SERIALIZED_ERROR = 'serialized-error'

/** The server said it is done. Distinct from "no event in this frame". */
const END_OF_STREAM = Symbol('end of stream')

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * One SSE frame → the event in it, nothing (a control frame), or the end.
 *
 * Written to the event-stream spec rather than to what tRPC happens to emit:
 * fields are `name: value` with one optional leading space, unknown fields are
 * ignored, and a `:` line is a comment. That is what makes a keep-alive the
 * server adds later a frame this already skips.
 */
function eventFromFrame(block: string): WireEvent | typeof END_OF_STREAM | undefined {
  let kind: string | undefined
  const data: string[] = []

  for (const line of block.split('\n')) {
    if (line === '' || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
    if (field === 'event') kind = value
    else if (field === 'data') data.push(value)
  }

  if (kind === CONNECTED || kind === PING) return undefined
  if (kind === RETURN) return END_OF_STREAM
  if (kind === SERIALIZED_ERROR) {
    throw new ServerError(`the event stream reported an error: ${data.join('\n')}`)
  }
  if (data.length === 0) return undefined

  let payload: unknown
  try {
    payload = JSON.parse(data.join('\n'))
  } catch (cause) {
    throw new ServerError(`the event stream sent a frame that is not JSON: ${messageOf(cause)}`)
  }

  // Validated with the **server's own** schema, imported from `@retro/api`, so
  // the CLI and the review page cannot drift into disagreeing about what an
  // event is. `wireEventSchema` is strict: an unknown key is a refusal, not a
  // field quietly dropped.
  const parsed = wireEventSchema.safeParse(payload)
  if (!parsed.success) {
    throw new ServerError(`the event stream sent an event this build does not recognise`)
  }
  return parsed.data
}

function wasAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

/**
 * The server's `events.onRetro` stream, as an async iterable of events —
 * **the same channel, at the same ~300 ms cadence, that updates every open
 * review page** (realtime.md).
 *
 * Three endings, and the difference between them is the whole contract with
 * `review wait --follow`:
 *
 * - **It runs out** — the server closed the stream, or sent `return`. Not an
 *   error: a server going away is what the store fallback exists for, so the
 *   generator simply finishes and lets the caller poll.
 * - **It raises `ServerError`** — the stream could not be opened, or answered
 *   with something that is not an event stream, or carried an error. Also not
 *   fatal to the caller for the same reason; it is raised rather than swallowed
 *   here because a library that hides why it failed cannot be diagnosed.
 * - **The caller aborts** — it stops, quietly. Aborting is how the wait ends the
 *   subscription when its own deadline passes, and a deadline is not a failure.
 *
 * Deliberately no reconnect. `EventSource` reconnects because a page lives for
 * hours; this subscription lives until one event arrives, and reconnecting would
 * be a slower, blinder version of the fallback the caller already has.
 */
export async function* subscribeToRetroEvents(
  options: RetroEventStreamOptions,
): AsyncGenerator<WireEvent> {
  const { origin, retroId, lastEventId, signal } = options

  let response: Response
  try {
    response = await fetch(retroEventStreamUrl(origin, retroId, lastEventId), {
      headers: { accept: 'text/event-stream' },
      signal,
    })
  } catch (cause) {
    if (wasAborted(signal)) return
    throw new ServerError(`could not open the event stream at ${origin}: ${messageOf(cause)}`)
  }

  if (!response.ok) {
    throw new ServerError(`the event stream at ${origin} answered ${response.status}`)
  }
  if (!(response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    throw new ServerError(`${origin} answered the subscription with something else`)
  }
  if (response.body === null) return

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      // Typed off the reader rather than by name: `ReadableStreamReadResult` is
      // not in the lib this package compiles against, and inferring it cannot
      // go stale the way a hand-written shape can.
      let chunk: Awaited<ReturnType<typeof reader.read>>
      try {
        chunk = await reader.read()
      } catch (cause) {
        if (wasAborted(signal)) return
        throw new ServerError(`the event stream from ${origin} broke: ${messageOf(cause)}`)
      }
      if (chunk.done) return

      buffer += decoder.decode(chunk.value, { stream: true })

      // A frame ends at a blank line. One read can carry several frames and one
      // frame can span several reads, so the buffer is drained rather than the
      // chunk being read as a message.
      for (
        let boundary = buffer.indexOf('\n\n');
        boundary !== -1;
        boundary = buffer.indexOf('\n\n')
      ) {
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)

        const event = eventFromFrame(block)
        if (event === END_OF_STREAM) return
        if (event !== undefined) yield event
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}
