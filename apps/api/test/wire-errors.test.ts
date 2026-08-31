import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createServerRuntime, type ServerRuntime } from '#server'
import { SCRUBBED_MESSAGE } from '#trpc/errors'
import { type ApiHarness, createApiHarness } from './support/harness'

type WireError = {
  readonly error: {
    readonly message: string
    readonly data: Record<string, unknown>
  }
}

/**
 * The **formatted** error, as it leaves over HTTP.
 *
 * `createCaller` never runs `errorFormatter` — it throws the `TRPCError` object
 * itself — so every other test in this package proves the *code* is right while
 * proving nothing about the JSON a browser receives. The typed mock restates
 * `data.pendingRids` by hand, and until this file nothing held the two to the
 * same shape: the server could have moved the payload and the mock would have
 * kept serving the old one, with the compiler and both suites still green.
 */
describe('the formatted error on the wire', () => {
  let api: ApiHarness
  let runtime: ServerRuntime
  let retroId: number

  beforeEach(async () => {
    api = createApiHarness()
    const sessionId = await api.session()
    retroId = await api.revision(sessionId, [{}, {}])
    runtime = createServerRuntime({ app: api.app, eventSource: api.store })
  })

  afterEach(async () => {
    await runtime.stop()
  })

  async function post(
    procedure: string,
    input: unknown,
  ): Promise<{ status: number; body: WireError }> {
    const response = await runtime.handler(
      new Request(`http://localhost/trpc/${procedure}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    )
    return { status: response.status, body: (await response.json()) as WireError }
  }

  test('puts the finish-gate payload at exactly data.pendingRids', async () => {
    const { status, body } = await post('review.finish', { retroId })

    expect(status).toBe(412)
    expect(body.error.data.code).toBe('PRECONDITION_FAILED')
    // The path the review page reads, pinned. Moving it is a wire change.
    expect(body.error.data.pendingRids).toEqual(['r-record-1', 'r-record-2'])
  })

  test('narrows the payload as records get decided', async () => {
    await api.caller.decisions.record({
      retroId,
      rid: 'r-record-1',
      revision: 1,
      state: 'approved',
    })

    const { body } = await post('review.finish', { retroId })

    expect(body.error.data.pendingRids).toEqual(['r-record-2'])
  })

  test('carries no pendingRids on errors that are not the finish gate', async () => {
    const { status, body } = await post('review.finish', { retroId: 404 })

    expect(status).toBe(404)
    expect(body.error.data.code).toBe('NOT_FOUND')
    expect(body.error.data).not.toHaveProperty('pendingRids')
  })

  test('scrubs the message of an error it did not expect', async () => {
    // A store that fails is not something the browser can act on, and its
    // internals are not the browser's business.
    const broken = createServerRuntime({
      app: {
        ...api.app,
        review: {
          ...api.app.review,
          finish: {
            execute: async () => {
              throw new Error('connection reset while reading /Users/haider/secrets')
            },
          },
        },
      } as unknown as ApiHarness['app'],
      eventSource: api.store,
    })

    const response = await broken.handler(
      new Request('http://localhost/trpc/review.finish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ retroId }),
      }),
    )
    const body = (await response.json()) as WireError

    expect(response.status).toBe(500)
    expect(body.error.message).toBe(SCRUBBED_MESSAGE)
    expect(body.error.message).not.toContain('secrets')
    await broken.stop()
  })

  test('answers a well-formed request normally, so the shape above is the exception', async () => {
    // A query is a GET with its input in the query string; only mutations POST.
    const input = encodeURIComponent(JSON.stringify({ retroId }))
    const response = await runtime.handler(
      new Request(`http://localhost/trpc/records.list?input=${input}`),
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as { result: { data: { pending: number } } }
    expect(body.result.data.pending).toBe(2)
  })
})
