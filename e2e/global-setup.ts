import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Builds the real web app once for the whole suite.
 *
 * `serve` serves `apps/web/dist`, so without this the scenarios would drive
 * whatever build was left over from a previous run — or the server's "no web
 * build" message, which fails in a way that looks like a routing bug. Building
 * here makes suite 5 self-contained: it runs on its own and never depends on
 * the gate having run the web step first.
 *
 * It is the **unmocked** build. The mocked one belongs to suite 4; here every
 * byte is real.
 *
 * Through the app's one named build script, which is also what `up` runs and
 * what the "no web build" message tells a reader to type. Building up front
 * leaves the page newer than its source, so the `up` inside a scenario finds a
 * current page and builds nothing.
 */
export default function globalSetup(): Promise<void> {
  return new Promise((resolve, reject) => {
    const build = spawn('bun', ['run', 'build'], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
    })
    let stderr = ''
    build.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    build.on('error', reject)
    build.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`building apps/web failed (${code}):\n${stderr}`))
    })
  })
}
