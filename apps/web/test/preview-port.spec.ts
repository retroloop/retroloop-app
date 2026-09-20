import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { CHECKOUT, derivePort, PORT_RANGE, PREVIEW_PORT, RESERVED_PORTS } from '../preview-port.ts'

/**
 * The preview
 * server this suite drives used to bind the literal 24302 in every checkout, so
 * two worktrees could not verify at once; then it was derived from the checkout
 * alone, so two *runs* in one worktree could not either — the second died on
 * `--strictPort`, or worse, both ran and starved each other into rotating
 * timeouts that looked like a flaky run.
 *
 * The derivation is what these assert. That it *works* is asserted by the run
 * itself — this file is in the `meta` project of the same config whose
 * `webServer` binds `PREVIEW_PORT`, so a broken derivation takes the whole suite
 * down before any of it reaches an assertion.
 */

/** Where the lanes of one session actually live, plus the checkout they came from. */
const CHECKOUTS = [
  '/Users/sample/Developer/retro',
  '/Users/sample/Developer/retro/.claude/worktrees/fix-a',
  '/Users/sample/Developer/retro/.claude/worktrees/fix-b',
  '/Users/sample/Developer/retro/.claude/worktrees/fix-c',
  '/Users/sample/Developer/retro/.claude/worktrees/fix-d',
  '/Users/sample/Developer/retro/.claude/worktrees/hangar',
  '/Users/sample/Developer/retro-mirror-3',
]

/** Eighty consecutive pids, which is what runs started seconds apart get. */
const PIDS = Array.from({ length: 80 }, (_, step) => 1000 + step)

/**
 * The claim, and the reason the pid is in there at all: a second run in
 * a worktree that is already running one does not take the port out from under
 * it.
 *
 * It is a hash and not an allocator, so what can be asserted is that the pid
 * genuinely reaches the derivation and spreads across the range rather than
 * nudging it: 80 consecutive pids land on 58 of the 80 ports, which is what a
 * hash does and 1 is what dropping the pid does. Two runs still share a port
 * about one time in eighty — that is the trade against sharing one every time,
 * and it is bounded by the range brief-001 leaves free rather than by this file.
 */
test('gives two runs in one worktree their own ports', () => {
  const ports = PIDS.map((pid) => derivePort(CHECKOUT, pid))
  const distinct = new Set(ports).size

  expect(
    distinct,
    `80 consecutive pids in one checkout reach only ${distinct} ports`,
  ).toBeGreaterThanOrEqual(50)
  expect(derivePort(CHECKOUT, 4242), 'neighbouring pids answer the same port').not.toBe(
    derivePort(CHECKOUT, 4243),
  )
})

/**
 * The claim, which the pid must not have cost: the checkout is still in
 * the hash, so the lanes of one session do not contend.
 *
 * Counted over the same pids rather than asserted at one of them, because seven
 * paths in eighty ports collide for about a quarter of pids however good the
 * hash is — and a test that picked the pid where they don't would be reporting
 * the pid it picked. 60 of the 80 separate all seven; dropping the checkout from
 * the derivation makes it 0, which is the control this number is here for.
 */
test('gives each checkout of the repo its own port', () => {
  const separated = PIDS.filter(
    (pid) =>
      new Set(CHECKOUTS.map((checkout) => derivePort(checkout, pid))).size === CHECKOUTS.length,
  ).length

  expect(
    separated,
    `only ${separated} of ${PIDS.length} pids give all ${CHECKOUTS.length} checkouts a port of their own`,
  ).toBeGreaterThanOrEqual(50)
})

/**
 * The same run has to answer the same number every time and in both runtimes:
 * `vite.config.ts` computes it under Bun and this config computes it under Node,
 * and a preview server on one port with a suite pointed at another is a hang
 * rather than a failure.
 */
test('answers the same port for the same run, every time', () => {
  for (const checkout of CHECKOUTS) {
    for (const pid of [1, 4242, 99999]) {
      expect(derivePort(checkout, pid)).toBe(derivePort(checkout, pid))
    }
  }
})

/**
 * The ports brief-001 §Ports hands to something by name, the old 24302 among
 * them. A stale worktree still previewing there is the collision most likely to
 * actually happen, so the range is chosen to leave those alone rather than to be
 * merely unlikely to hit them.
 */
test('never lands on a port something fixed already binds', () => {
  const [first, last] = PORT_RANGE

  for (const checkout of [...CHECKOUTS, process.cwd()]) {
    for (const pid of PIDS) {
      const port = derivePort(checkout, pid)
      expect(port).toBeGreaterThanOrEqual(first)
      expect(port).toBeLessThanOrEqual(last)
      expect(RESERVED_PORTS, `${checkout} at pid ${pid} derives a reserved port`).not.toContain(
        port,
      )
    }
  }
})

/** This run's own, which is the one the config's `webServer` is holding. */
test('leaves the hand-allocated ports free, 24302 included', () => {
  expect(RESERVED_PORTS).not.toContain(PREVIEW_PORT)
})

/**
 * The seam the pid opened, and the one that fails as a hang rather than as a
 * failure: a run is a tree of processes — this worker, the runner that forked
 * it, and the `vite preview` the `webServer` spawns under Bun — and a pid is the
 * identity of the run, not of each of its parts. So the first process to want
 * the port publishes it and the rest adopt it.
 *
 * Asserted across a real process boundary, because that is the only place it can
 * be wrong. The child reports both halves and the parent recomputes what it
 * should have said, so the second case pins that a process with nothing
 * published derives from *its own* pid rather than, say, its parent's.
 */
const MODULE = new URL('../preview-port.ts', import.meta.url).href

function portOfChild(published: string | undefined): { pid: number; port: number } {
  const env = { ...process.env }
  delete env.PREVIEW_PORT
  if (published !== undefined) env.PREVIEW_PORT = published

  const said = execFileSync(
    'bun',
    [
      '-e',
      `const module = await import(${JSON.stringify(MODULE)})
       console.log(JSON.stringify({ pid: process.pid, port: module.PREVIEW_PORT }))`,
    ],
    { encoding: 'utf8', env },
  )
  return JSON.parse(said)
}

test('every process of one run answers the port the run published', () => {
  // Outside the derived range on purpose: a number the child could have reached
  // on its own would let this pass one time in eighty without adopting anything.
  const published = PORT_RANGE[1] + 600
  expect(
    portOfChild(String(published)).port,
    'the child derived its own port instead of adopting the run’s',
  ).toBe(published)
})

test('a process with nothing published derives the port from its own pid', () => {
  const child = portOfChild(undefined)
  expect(child.port, `pid ${child.pid} answered ${child.port}`).toBe(
    derivePort(CHECKOUT, child.pid),
  )
})
