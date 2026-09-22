import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_STATIC_ROOT } from '#server'
import { createStaticHandler, WEB_BUILD_COMMAND, WEB_BUILD_INDEX, webBuildRootFrom } from '#static'

const roots: string[] = []
afterAll(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const INDEX = '<!doctype html><title>Retro</title><div id="root"></div>'

function aBuild(): string {
  const root = mkdtempSync(join(tmpdir(), 'retro-web-'))
  roots.push(root)
  writeFileSync(join(root, 'index.html'), INDEX)
  mkdirSync(join(root, 'assets'))
  writeFileSync(join(root, 'assets', 'app.js'), 'console.log("app")')
  return root
}

/**
 * Serving the web build.
 *
 * Against a fixture directory rather than a real `vite build`: what is under test
 * is the handler's routing — file, fallback, refusal — and building the app to
 * assert that would make every run slower without proving anything more. The real
 * `apps/web/dist` is wired in the CLI's `serve` command and driven by suite 5.
 */
describe('static serving', () => {
  let root: string

  beforeEach(() => {
    root = aBuild()
  })

  test('serves the built page at /', async () => {
    const handler = createStaticHandler({ root })

    const response = await handler(new Request('http://localhost/'))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(INDEX)
  })

  test('serves a real asset as itself', async () => {
    const handler = createStaticHandler({ root })

    const response = await handler(new Request('http://localhost/assets/app.js'))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('console.log("app")')
  })

  test('falls back to index for a client route', async () => {
    const handler = createStaticHandler({ root })

    // `/retros/12` is a page the browser renders, not a file we have. Without
    // the fallback every deep link and every refresh would 404.
    const response = await handler(new Request('http://localhost/retros/12'))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(INDEX)
    expect(response.headers.get('content-type')).toContain('text/html')
  })

  test('refuses a path that climbs out of the build directory', async () => {
    const handler = createStaticHandler({ root })

    // A plain `/../..` never arrives: the URL parser normalizes it away, and so
    // does `%2e%2e`. What does arrive is an **encoded slash** — the parser leaves
    // `%2f` inert, and the handler's own `decodeURIComponent` turns it back into
    // a separator. The guard exists because of that decode, which is exactly why
    // this is the form worth testing.
    const response = await handler(
      new Request('http://localhost/assets%2f..%2f..%2f..%2fetc/passwd'),
    )

    expect(response.status).toBe(403)
  })

  test('a path the URL parser already normalized is simply not found', async () => {
    const handler = createStaticHandler({ root })

    const response = await handler(new Request('http://localhost/../../etc/passwd'))

    // Normalized to `/etc/passwd`, which is not in the build, so it is a client
    // route as far as the server can tell — index, not the host's password file.
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(INDEX)
  })

  test('says so plainly when the web app was never built', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'retro-nobuild-'))
    roots.push(empty)
    const handler = createStaticHandler({ root: empty })

    const response = await handler(new Request('http://localhost/'))

    expect(response.status).toBe(503)
    expect(await response.text()).toContain('No web build')
  })

  test('names the one documented build command when there is no build', async () => {
    // One name for the build, written once: this body, the start command's
    // failure and the instructions all say the same thing, so a reader who
    // copies any of them types a command that exists.
    const empty = mkdtempSync(join(tmpdir(), 'retro-nobuild-'))
    roots.push(empty)
    const handler = createStaticHandler({ root: empty })

    const body = await (await handler(new Request('http://localhost/'))).text()

    expect(WEB_BUILD_COMMAND).toBe('bun run build')
    expect(body).toContain(`Run ${WEB_BUILD_COMMAND} in the app folder.`)
  })

  test('defaults to the web package’s build directory', () => {
    expect(DEFAULT_STATIC_ROOT.endsWith('/apps/web/dist')).toBe(true)
  })

  test('points at the one index file the whole app agrees on', () => {
    expect(WEB_BUILD_INDEX).toBe(join(DEFAULT_STATIC_ROOT, 'index.html'))
  })

  test('reads a folder name with a space as a folder name with a space', () => {
    // `new URL(…).pathname` hands back `retro%20check`, a directory that does not
    // exist: the server would 503 on a checkout whose path has a space in it, and
    // the start command would rebuild the page on every single start.
    expect(webBuildRootFrom('file:///tmp/retro%20check/apps/api/src/static.ts')).toBe(
      '/tmp/retro check/apps/web/dist',
    )
    expect(DEFAULT_STATIC_ROOT).not.toContain('%')
  })
})
