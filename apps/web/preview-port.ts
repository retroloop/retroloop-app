import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The port `vite preview` binds, derived from the checkout it is running in and
 * the run that is driving it.
 *
 * It used to be the literal 24302, written into `playwright.config.ts` and into
 * two package scripts. One number for every checkout of the repo means two
 * worktrees cannot verify at the same time: the second `bun run gate` dies on
 * `--strictPort` partway through the web suite, so a worktree that is finished
 * waits on one that is not, for a reason that has nothing to do with either.
 *
 * The absolute path of the checkout is the one thing that is stable across a
 * worktree's whole life and different between any two of them — a branch name
 * is neither. So the port is a hash of it.
 *
 * That isolates worktrees, and the unit that actually contends is the *run*:
 * two processes — one running a suite, another running the gate — in one
 * worktree at once, both derived the same port from the same path, and two
 * gate runs on the same commit failed a rotating scenario each, twice,
 * though neither run was wrong. So the run's own process id is hashed in
 * beside the path. Two runs in one tree are two pids and two ports; the class
 * is gone rather than scheduled around, bar the one time in eighty that
 * eighty ports hands the same number to both.
 *
 * The range sits clear of every port brief-001 §Ports allocates by hand — the
 * server, the dev server, the reference build, the old preview port, and the
 * review round. A stale worktree still previewing on 24302 is the collision most
 * likely to actually happen, so it is ruled out rather than merely made unlikely.
 */

/** apps/web/preview-port.ts → apps/web → apps → the checkout root. */
export const CHECKOUT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

const FIRST_PORT = 24320
const PORT_COUNT = 80

/**
 * FNV-1a over the path and the pid, folded into the range.
 *
 * Hand-rolled and not cryptographic on purpose: this has to produce the same
 * number under Bun (vite) and under Node (playwright) with no dependency
 * between them, and the only property being asked of it is that two runs rarely
 * land on the same port.
 *
 * The pid goes through the same hash rather than being added to the result, so
 * that neighbouring pids — which is what two runs started seconds apart get —
 * land nowhere near each other. Adding it would make the run one worktree along
 * collide with the run one pid along.
 */
export function derivePort(checkout: string, pid: number): number {
  const input = `${checkout}\0${pid}`
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return FIRST_PORT + (hash % PORT_COUNT)
}

/**
 * The ports nothing derived may land on: brief-001 §Ports hands each of these to
 * something by name — 24100 the server, 24300 `dev`, 24301 the reference build,
 * 24302 the preview port this replaces, 24310 the review round.
 */
export const RESERVED_PORTS: readonly number[] = [24100, 24300, 24301, 24302, 24310]

export const PORT_RANGE: readonly [number, number] = [FIRST_PORT, FIRST_PORT + PORT_COUNT - 1]

/**
 * This run's preview port. Read by `vite.config.ts` and `playwright.config.ts`.
 *
 * A run is a tree of processes and they all have to name one port: playwright
 * derives it, its workers re-load the config, and the `webServer` command it
 * spawns runs `vite preview` under Bun, which reads this same module with a pid
 * of its own. Deriving in each of them would give a suite pointed at one port
 * and a server bound to another — a hang rather than a failure, which is the
 * worst way for this to be wrong.
 *
 * So the first process to want it derives it and publishes it into the
 * environment, and every process the run starts after that adopts it. A pid is
 * the identity of the run, not of each of its parts.
 *
 * `PREVIEW_PORT` in the environment is therefore also the override: setting it
 * by hand points a preview server and a suite at a port you chose.
 */
export const PREVIEW_PORT = adopted() ?? derivePort(CHECKOUT, process.pid)

process.env.PREVIEW_PORT = String(PREVIEW_PORT)

function adopted(): number | undefined {
  const published = process.env.PREVIEW_PORT
  if (published === undefined) return undefined
  const port = Number(published)
  return Number.isInteger(port) && port > 0 ? port : undefined
}
