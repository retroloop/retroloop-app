import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Where the built review page lives, from a module's own URL.
 *
 * `fileURLToPath`, never `new URL(…).pathname`: a checkout under a folder whose
 * name has a space in it comes back from `.pathname` as `retro%20check`, a
 * directory that does not exist. The server would then answer every request with
 * "no web build", and the start command would rebuild the page on every start.
 */
export function webBuildRootFrom(moduleUrl: string | URL): string {
  return fileURLToPath(new URL('../../web/dist', moduleUrl))
}

/** The one built-page location. The server serves it; `up` builds into it. */
export const DEFAULT_STATIC_ROOT = webBuildRootFrom(import.meta.url)

/** The file whose absence means the page was never built. */
export const WEB_BUILD_INDEX = join(DEFAULT_STATIC_ROOT, 'index.html')

/**
 * The one documented name for building the page, run from the app folder.
 *
 * Written once and read wherever it is said — this package's "no web build"
 * body, the start command's failure, the end-to-end setup and the README — so a
 * reader who copies any of them types a command that exists.
 */
export const WEB_BUILD_COMMAND = 'bun run build'

export type StaticHandlerOptions = {
  /** Directory of the built web app. */
  readonly root: string
}

/**
 * Serves the `apps/web` build.
 *
 * Anything that is not a file on disk falls back to `index.html`, because the
 * client owns the routes: `/retros/12` is a page the browser renders, not a file
 * the server has. Without the fallback, every deep link and every refresh would
 * 404 — the URL would work only if you arrived by clicking.
 *
 * The fallback is also why the traversal check matters: a request path becomes a
 * filesystem path here, so a resolved path that escapes the root is refused
 * rather than served.
 */
export function createStaticHandler(options: StaticHandlerOptions) {
  const root = resolve(options.root)
  const indexPath = join(root, 'index.html')

  return async function serveStatic(request: Request): Promise<Response> {
    const pathname = decodeURIComponent(new URL(request.url).pathname)
    const requested = resolve(join(root, pathname))

    if (requested !== root && !requested.startsWith(`${root}/`)) {
      return new Response('Forbidden', { status: 403 })
    }

    if (requested !== root) {
      const file = Bun.file(requested)
      if (await file.exists()) return new Response(file)
    }

    const index = Bun.file(indexPath)
    if (await index.exists()) {
      return new Response(index, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    }

    // Honest about the one thing that can be missing: the web app was never built.
    // `up` builds it before it hands over a link, so this is what is left — a
    // server started some other way, against a checkout that was never built.
    return new Response(`No web build at ${root}. Run ${WEB_BUILD_COMMAND} in the app folder.\n`, {
      status: 503,
      headers: { 'content-type': 'text/plain' },
    })
  }
}
