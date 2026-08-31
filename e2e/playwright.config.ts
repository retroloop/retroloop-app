import { defineConfig, devices } from '@playwright/test'
import { defineBddConfig } from 'playwright-bdd'

/**
 * All-real e2e suite (suite 5 in docs/design/testing.md): real binary CLI, real
 * server, real browser contexts, real export file. Capped at ~3 scenarios — they
 * prove wiring only, because everything else is proven a layer down.
 *
 * The scenarios land with BACKLOG item 7; until then this config exists so the
 * runner is wired and the gate exercises it (`--pass-with-no-tests`).
 */
const testDir = defineBddConfig({
  features: ['features/**/*.feature'],
  steps: ['steps/**/*.ts', 'fixtures.ts'],
})

export default defineConfig({
  testDir,
  /** Builds the real web app once: `serve` serves `apps/web/dist`. */
  globalSetup: './global-setup.ts',
  /**
   * Each scenario spawns processes, migrates a database and drives a browser.
   * Generous per scenario, while the suite as a whole stays inside testing.md's
   * ~2 minute cap — the budget is for the suite, not for hiding a hang.
   */
  timeout: 90_000,
  // "A flaky test is a bug in the test" — docs/design/testing.md.
  retries: 0,
  // Real-time scenarios coordinate two browser contexts and a CLI write: serial.
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
