import { DEFAULT_BIND, humanUrlFor } from '#server/address'

export type ServerHandler = (request: Request) => Response | Promise<Response>

export type RunningServer = {
  readonly url: string
  readonly port: number
  stop(): Promise<void>
}

export type StartServerOptions = {
  /** `0` asks the OS for a free port — what tests want. */
  readonly port: number
  readonly hostname?: string
  readonly handler: ServerHandler
}

export function startServer(options: StartServerOptions): RunningServer {
  const server = Bun.serve({
    port: options.port,
    hostname: options.hostname ?? '127.0.0.1',
    fetch: options.handler,
  })

  // Bun types the port as optional (a unix socket has none); a TCP listener
  // always has one, and asking for port 0 is precisely how a test learns it.
  const port = server.port ?? options.port

  return {
    // The link for the address the socket above took — described, not chosen.
    url: humanUrlFor(options.hostname ?? DEFAULT_BIND, port),
    port,
    stop: async () => {
      await server.stop(true)
    },
  }
}
