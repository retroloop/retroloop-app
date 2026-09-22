import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WEB_BUILD_COMMAND } from '@retro/api'

/** What a build says for itself: whether it worked, and everything it printed. */
export type WebBuildResult = {
  readonly ok: boolean
  readonly output: string
}

/**
 * The app folder, from this module's own URL — `fileURLToPath`, never
 * `.pathname`, so a checkout under a folder name with a space in it resolves to
 * the folder that exists rather than to one spelled `%20`.
 */
export const APP_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/**
 * Everything the built page is made of: the web app, and the lockfile, because
 * an update that moves a dependency changes what a build produces without
 * touching a single source file.
 */
export const WEB_SOURCE_PATHS: readonly string[] = [
  join(APP_ROOT, 'apps', 'web'),
  join(APP_ROOT, 'bun.lock'),
]

/**
 * Not source, wherever it appears under the paths above.
 *
 * `node_modules` holds tens of thousands of files that every install stamps with
 * the current time — walking it would cost more than the build it is deciding
 * about, and it would decide "stale" every time. A build's own output is newer
 * than the build by definition, so the same goes for `dist` and its siblings.
 */
const NOT_SOURCE = new Set([
  'node_modules',
  'dist',
  'dist-mocked',
  '.features-gen',
  'test-results',
  'playwright-report',
  'blob-report',
])

function newerFileExists(path: string, thanMs: number): boolean {
  const stats = statSync(path, { throwIfNoEntry: false })
  if (stats === undefined) return false
  if (!stats.isDirectory()) return stats.mtimeMs > thanMs

  // A directory's own timestamp is not read: it moves when a file is added or
  // removed, which is exactly what a build does to `dist` inside `apps/web` —
  // every build would then make the page stale again.
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (NOT_SOURCE.has(entry.name)) continue
    if (newerFileExists(join(path, entry.name), thanMs)) return true
  }
  return false
}

/**
 * Whether the review page has to be built before anyone is handed a link.
 *
 * Two reasons, and only two: the page is not there at all, or **some source file
 * is strictly newer than the built index**. Strictly, because the build writes
 * that index at the end of the same second it read the sources in, and "newer or
 * the same" would make a fresh build stale the moment it finished.
 *
 * Modification times cannot see everything — a checkout that restores old
 * timestamps reads as current — and the documented build command stays the
 * answer for that. What this does catch is the two cases that happen daily: a
 * machine that has never built, and an update that rewrote files.
 */
export function reviewPageNeedsBuilding(
  indexPath: string,
  sourcePaths: readonly string[],
): boolean {
  const built = statSync(indexPath, { throwIfNoEntry: false })
  if (built === undefined) return true
  return sourcePaths.some((path) => newerFileExists(path, built.mtimeMs))
}

/**
 * Runs the one documented build, in the app folder.
 *
 * The command is split off the name that is printed everywhere else, so what a
 * failure tells someone to type is the very thing this ran — and it is handed
 * over as an argument list rather than a shell line, so a space in the path of
 * the app folder is a character in a path and nothing more.
 *
 * Everything it prints is captured and given back rather than written out: under
 * `--json` stdout carries exactly one object, and a build's progress lines are
 * not it. They are shown only when the build fails, which is when they are worth
 * reading.
 */
export async function buildReviewPage(
  command: string = WEB_BUILD_COMMAND,
  cwd: string = APP_ROOT,
): Promise<WebBuildResult> {
  const build = Bun.spawn(command.split(' '), {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const [out, err, code] = await Promise.all([
    new Response(build.stdout).text(),
    new Response(build.stderr).text(),
    build.exited,
  ])
  return { ok: code === 0, output: `${out}${err}`.trim() }
}
