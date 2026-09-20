import { defineConfig, devices } from '@playwright/test'
import { defineBddConfig } from 'playwright-bdd'
import { PREVIEW_PORT } from './preview-port.ts'

const bddTestDir = defineBddConfig({
  features: ['features/**/*.feature'],
  steps: ['features/**/*.ts'],
  featuresRoot: 'features',
})

/**
 * Derived from this checkout's path and this run's pid, not written down
 * (`preview-port.ts`): the literal 24302 that used to be here meant two
 * worktrees could not verify at the same time, and the path alone meant two runs
 * in one worktree could not either — both died on `--strictPort` for a reason
 * that had nothing to do with the change under test.
 *
 * Importing it here is what fixes it for the whole run: the derivation publishes
 * itself into the environment, and the workers this process forks and the
 * `webServer` it spawns adopt that number instead of deriving one from a pid of
 * their own.
 */
const baseURL = `http://127.0.0.1:${PREVIEW_PORT}`

/**
 * The screen a scenario that does not name one is standing on, and the rule it is
 * chosen by: **it sits on the wide side of the geometry, well clear of the
 * breakpoint.** `Desktop Chrome` brings 1280×720, which used to be exactly where
 * the review's third column became possible — the default sat on the breakpoint
 * and every unstated scenario read the wide layout by one pixel. The
 * breakpoint moved to 1344 and this default was set to 1440×900 so that the next
 * change to the geometry would move the scenarios that chose their width rather
 * than all the ones that didn't.
 *
 * **A later change caught the laptop.** The rails widened, which moved the
 * breakpoint with them to 92rem / 1472px (`lib/side-panel.ts`), and 1440 is
 * below it: on the laptop the review is now one column with both panels behind
 * their glyphs. Left alone, the default would have silently handed the whole
 * suite the narrow layout — the exact accident the paragraph above exists to
 * prevent — so the default moves and the rule holds.
 *
 * 1536×960 is the width at which the three columns close flush against the
 * measure, and the width the feature files name wherever they need the wide layout
 * now. That the laptop is no longer one of those widths is the geometry's doing
 * and is flagged for review, not decided here.
 *
 * It is one object shared by both browser projects below rather than two literals:
 * the serialized project differs from the parallel bulk in **when it runs and how
 * many browsers run beside it**, and in nothing else. A second copy of this
 * viewport would let the two drift, and a scenario that reads a different layout
 * on the other side of the boundary would look like the boundary's doing.
 */
const desktop = { ...devices['Desktop Chrome'], viewport: { width: 1536, height: 960 } }

/**
 * The membership mark for the serialized starvation project — the tag a scenario
 * carries when it **starves the renderer on purpose** (`docs/design/testing.md`
 * §The stall edge holds the criteria).
 *
 * The mechanism, measured rather than argued. A scenario in this class stops its
 * own renderer painting — by holding the page's main thread, or by throttling the
 * CPU through Chromium's own emulation; both engines are in use and testing.md says
 * which suits which — and then asks for something against a wall-clock budget. That budget is spent by
 * whatever else the machine is doing — including, and mostly, the four sibling
 * browsers this suite runs beside it: on this tip, at the gate's own five workers,
 * the landing scenario passes and finishes at 16.6s; the same scenario at twelve
 * concurrent copies on twelve workers failed **12 of 12**, every one of them
 * `Timeout 15000ms exceeded while waiting on the predicate` with the page alive.
 * A bigger number would not have fixed that, because the number it competes with
 * is however many browsers the suite happens to be running.
 *
 * So the boundary is scheduling, not budget: tagged scenarios leave the parallel
 * bulk (`grepInvert` below) and run afterwards, one worker, nothing beside them —
 * the same boundary `e2e/playwright.config.ts` already draws for the all-real
 * suite, and for the same reason.
 */
const STARVED = /@starved/

export default defineConfig({
  testDir: bddTestDir,
  // "A flaky test is a bug in the test" — docs/design/testing.md.
  retries: 0,
  fullyParallel: true,
  forbidOnly: true,
  reporter: 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    /**
     * The bulk: every scenario that does not starve its own renderer, at whatever
     * parallelism the machine offers. `grepInvert` is what makes the split a split
     * rather than a duplication — without it the tagged scenarios would run here
     * too, in parallel, which is the condition the project below exists to remove.
     */
    {
      name: 'chromium',
      testDir: bddTestDir,
      grepInvert: STARVED,
      use: desktop,
    },
    /**
     * The serialized starvation project: the same browser, the same viewport, the
     * same budgets — **after** the bulk, and alone.
     *
     * `dependencies` is the ordering and `workers` is the isolation, and it takes
     * both. `workers: 1` on its own caps this project's own concurrency while
     * Playwright happily schedules the bulk's browsers in the other four worker
     * slots beside it, which is the contention itself. `dependencies: ['chromium']`
     * is what says *afterwards*: every test in the bulk has finished before the
     * first test here starts, so by the time a starved renderer is asked to meet a
     * wall-clock budget there is nothing left of this suite to compete with.
     *
     * Not `meta`: its 32 tests spawn no browser and finish in milliseconds well
     * inside the bulk's first seconds, so naming it here would buy no quiet and
     * would widen what a failure elsewhere can take down with it — a dependency
     * project that fails takes its dependents' tests with it as skips, which is the
     * price of the ordering and is stated in `docs/design/testing.md` so that
     * anyone reading `2 did not run` under a red bulk knows what it means.
     *
     * **Debugging these does not need the bulk's 348.** `--no-deps` ignores the
     * dependency, so the whole project is reachable on its own:
     *
     * That number is hand-maintained and nothing checks it — it read 331 when
     * the bulk was 330, was corrected once, and had gone stale again by five
     * before this line was next read. Two changes landing at once is all it
     * takes. `bunx playwright test --list` is the authority; this is a reader's
     * sense of scale and should be treated as one:
     *
     *   cd apps/web && bun run test --project=starved --no-deps
     */
    {
      name: 'starved',
      testDir: bddTestDir,
      grep: STARVED,
      workers: 1,
      dependencies: ['chromium'],
      use: desktop,
    },
    // The procedure-set meta-test: no browser, just the mock's own shape.
    { name: 'meta', testDir: './test', testMatch: /.*\.spec\.ts$/ },
  ],
  webServer: {
    /**
     * The gate loads a *build*, never the dev server — and it builds both.
     * `build` is the SPA the server's `static.ts` serves, built here so a
     * production-only break cannot hide behind the mocked one; `build:mocked` is
     * the same app with the typed tRPC mock linked in, which is what these
     * scenarios drive (R-MOCK-LOCK).
     */
    command: 'bun run build && bun run build:mocked && bun run preview:mocked',
    /**
     * Said out loud rather than left to inheritance. The preview server is a
     * separate process with a pid of its own, so it must be told this run's port
     * instead of deriving one — and the failure if it ever derived its own would
     * be a suite waiting on a URL nothing is bound to, which is a timeout with
     * no evidence in it.
     */
    env: { PREVIEW_PORT: String(PREVIEW_PORT) },
    url: baseURL,
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
