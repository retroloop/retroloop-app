import { createServerRuntime } from '@retro/api'
import { createApp } from '@retro/core'
import type { Argv } from 'yargs'
import { createOutput } from '#output'
import type { CliRuntime, GlobalOptions } from '#runtime'
import {
  boundToSuffix,
  DEFAULT_BIND,
  lanUrlFor,
  lanUrlMember,
  lanUrlSuffix,
  refuseWildcardBind,
} from '#server/address'
import { acquireLock, releaseLock } from '#server/lock'
import { startServer } from '#server/serve'
import { resolveStage } from '#stage'

function waitForShutdown(): Promise<void> {
  return new Promise((resolve) => {
    process.once('SIGTERM', () => resolve())
    process.once('SIGINT', () => resolve())
  })
}

/**
 * `serve` — the low-level foreground command the boot service runs.
 *
 * It does not use the shared context helper: that opens a store for the duration
 * of one command and closes it, whereas the server holds its store for as long as
 * it is up. The order below is the contract — **take the lock first**, so a second
 * `serve` on the same stage fails before it has migrated anything or bound a port.
 *
 * What item 5 changes is one line: the handler. The lock, the stage, the store and
 * the shutdown path stay exactly as they are.
 */
export function registerServeCommand(
  cli: Argv<GlobalOptions>,
  runtime: CliRuntime,
): Argv<GlobalOptions> {
  return cli.command(
    'serve',
    'Run the server in the foreground',
    (yargs) =>
      yargs
        .option('port', { type: 'number', describe: 'Port to listen on [default: 24100]' })
        .option('bind', {
          type: 'string',
          describe: `Address to bind. A specific interface IP (e.g. 192.168.1.9) exposes the server on that network; 0.0.0.0 and :: are refused. [default: ${DEFAULT_BIND}]`,
        }),
    async (args) => {
      // Ahead of the lock, the stage and the store, for the same reason the lock
      // comes first: a refusal must land before anything has been touched.
      const bind = args.bind ?? DEFAULT_BIND
      refuseWildcardBind(bind)

      const stage = resolveStage({
        data: args.data,
        port: args.port,
        env: runtime.env,
        cwd: runtime.cwd,
      })
      const output = createOutput({
        json: args.json === true,
        quiet: args.quiet === true,
        out: runtime.out,
        err: runtime.err,
      })

      acquireLock(stage.lockFile, {
        pid: process.pid,
        port: stage.port,
        bind,
        startedAt: runtime.clock.now().toISOString(),
      })

      // Opening the stage is what applies pending migrations, under the write
      // lock (KC-0006). No user-facing migrate command exists, by design.
      const store = runtime.openStore(stage)
      // A second handle on the same file for the tailer to watch: `data_version`
      // does not move for a connection's own commits, so a tailer sharing the
      // writer's handle would miss every write the server itself makes.
      const watcher = runtime.openStore(stage)

      const api = createServerRuntime({
        app: createApp(store, { clock: runtime.clock }),
        eventSource: watcher,
        clock: runtime.clock,
      })
      const server = startServer({
        port: stage.port,
        hostname: bind,
        handler: api.handler,
      })

      try {
        const lanUrl = lanUrlFor(bind, server.port, runtime.hostAddresses)
        output.result(
          {
            url: server.url,
            port: server.port,
            pid: process.pid,
            bind,
            dataDir: stage.dataDir,
            ...lanUrlMember(lanUrl),
          },
          () =>
            `retroloop serving ${server.url} (pid ${process.pid})${boundToSuffix(bind)}${lanUrlSuffix(lanUrl)}`,
        )
        await waitForShutdown()
      } finally {
        // Stop taking traffic, then the tailer, then let the handles go.
        await server.stop()
        await api.stop()
        await watcher.close()
        await store.close()
        releaseLock(stage.lockFile)
      }
    },
  )
}
