import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { PREVIEW_PORT } from './preview-port.ts'

const here = import.meta.dirname

/**
 * Two builds of one app.
 *
 * `vite build` is the SPA the server embeds and `static.ts` serves: it talks to
 * a real tRPC endpoint over HTTP. `vite build --mode mocked` is the same app
 * with one module swapped — `@/lib/transport`, the tRPC link factory, resolves
 * to the single typed mock instead. That is the whole of R-MOCK-LOCK's seam:
 * the web Gherkin suite drives the real router-free app through the real tRPC
 * client, and the mock is the thing on the far end of the client rather than
 * something wrapped around the network (testing.md suite 4).
 *
 * The alias is why no test file has to reach past the client: there is nothing
 * to intercept, because no request is ever made. It also keeps the mock out of
 * the production bundle without a runtime flag — `dist/` cannot contain code
 * that was never resolved.
 */
export default defineConfig(({ mode }) => {
  const mocked = mode === 'mocked'

  return {
    plugins: [
      tanstackRouter({ target: 'react', autoCodeSplitting: false }),
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        ...(mocked ? { '@/lib/transport': path.resolve(here, './test/trpc-mock.ts') } : {}),
        '@': path.resolve(here, './src'),
      },
    },
    build: mocked ? { outDir: 'dist-mocked' } : {},
    /**
     * Derived per checkout and per run, so two worktrees can run the gate at
     * once and two runs in one worktree do not contend (`preview-port.ts`). It
     * lives here rather than in the package scripts because
     * `playwright.config.ts` has to name the same number, and two places
     * computing it is two places to get it wrong — when playwright starts this
     * server it hands the number down in the environment rather than letting
     * this process derive one of its own.
     *
     * `strictPort`, because a preview that silently moved to the next free port
     * would be a suite driving one server while asserting against another.
     */
    preview: { port: PREVIEW_PORT, strictPort: true, host: '127.0.0.1' },
  }
})
