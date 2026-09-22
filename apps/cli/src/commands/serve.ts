import { createServerRuntime } from '@retro/api'
import { createApp } from '@retro/core'
import type { Argv } from 'yargs'
import { createOutput } from '#output'
import type { CliRuntime, GlobalOptions } from '#runtime'
import {
  boundToSuffix,
  DEFAULT_BIND,
  remoteTunnelCommand,
  requireLoopbackBind,
  tunnelLine,
  tunnelMember,
} from '#server/address'
import { acquireLock, releaseLock } from '#server/lock'
import { startServer } from '#server/serve'
import { DEFAULT_PORT, resolveStage } from '#stage'

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
 * Changing what is served is one line: the handler. The lock, the stage, the
 * store and the shutdown path stay exactly as they are.
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
          describe: `Address to bind. The review server only ever listens on this machine, so only 127.0.0.1, ::1 and localhost are accepted; reach it from another computer over an SSH tunnel. [default: ${DEFAULT_BIND}]`,
        }),
    async (args) => {
      // Ahead of the lock, the stage and the store, for the same reason the lock
      // comes first: a refusal must land before anything has been touched. The
      // same rule and the same message as `up` — there are two doors to this
      // behaviour, and a caller must not be able to pick the softer one.
      const bind = args.bind ?? DEFAULT_BIND
      requireLoopbackBind(bind, args.port ?? DEFAULT_PORT)

      const stage = resolveStage({
        home: args.home,
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
      // lock. No user-facing migrate command exists, by design.
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
        const tunnel = remoteTunnelCommand(runtime.env, server.port)
        output.result(
          {
            url: server.url,
            port: server.port,
            pid: process.pid,
            bind,
            dataDir: stage.dataDir,
            ...tunnelMember(tunnel),
          },
          () => `retroloop serving ${server.url} (pid ${process.pid})${boundToSuffix(bind)}`,
        )
        const line = tunnelLine(tunnel, server.port)
        if (line !== undefined) output.note(line)
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
