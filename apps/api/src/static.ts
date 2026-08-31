import { join, resolve } from 'node:path'

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
    return new Response(`No web build at ${root}. Run \`bun run --filter '@retro/web' build\`.\n`, {
      status: 503,
      headers: { 'content-type': 'text/plain' },
    })
  }
}
