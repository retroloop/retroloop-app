import { networkInterfaces } from 'node:os'
import { UsageError } from '#errors'

/**
 * The address a server takes when nobody asks for another one.
 *
 * Loopback, and said so out loud in `--help`. cli.md's design narrative once
 * promised "auto LAN"; a tool that quietly puts a review server on the network
 * because you did not name an address is not being helpful, it is deciding
 * something for you. `--bind` is how you ask, and `--help` is the authoritative
 * statement of what happens when you do not. A `--bind` binds the one start it
 * was typed for: nothing carries it over into the next one.
 */
export const DEFAULT_BIND = '127.0.0.1'

/** Where a spawned `serve` is told to listen. */
export type ServeAddress = {
  readonly port: number
  readonly bind: string
}

/** One address a host interface carries — `os.networkInterfaces()`, flattened. */
export type HostAddress = {
  readonly address: string
  readonly family: string
  readonly internal: boolean
}

/** The real machine's addresses. Injected through `CliRuntime` so tests can fake it. */
export function systemHostAddresses(): readonly HostAddress[] {
  return Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .map((entry) => ({
      address: entry.address,
      family: String(entry.family),
      internal: entry.internal,
    }))
}

/** Every spelling of "this machine only": 127.0.0.0/8, `::1`, and the name for them. */
export function isLoopbackBind(bind: string): boolean {
  const host = bind.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  return host === 'localhost' || host === '::1' || host.startsWith('127.')
}

/** `0.0.0.0` and `::` mean "every interface" — which one that turns out to be is the question. */
export function isWildcardBind(bind: string): boolean {
  const host = bind.trim().replace(/^\[/, '').replace(/\]$/, '')
  return host === '0.0.0.0' || host === '::'
}

/**
 * Refuses a wildcard address before anything is started, written or locked.
 *
 * Every interface is not an address, it is "whoever can reach this machine", and
 * a review server holds a human's words in their own spelling. Naming one
 * interface is the same reach with the decision made out loud, so that is the
 * only way to leave loopback — and the message says which flag to type instead.
 */
export function refuseWildcardBind(bind: string): void {
  if (!isWildcardBind(bind)) return
  throw new UsageError(
    `--bind ${bind} is refused: it would expose the review server on every network interface. Bind one interface address instead, e.g. --bind 192.168.1.9.`,
  )
}

/** Just enough of the environment to tell a remote login from a local one. */
type RemoteLoginEnv = Readonly<Record<string, string | undefined>>

/**
 * The command to paste on your **own** computer to reach a review server that
 * listens only on the machine it runs on.
 *
 * The same port on both ends, because that is the form someone can read back
 * from the link they were given. The page asks its server for data at a relative
 * address, so a different local port works just as well — that variant is taught
 * in the install documentation rather than printed, since the number to pick
 * depends on what the reader is already running.
 */
export function tunnelCommandFor(port: number, host: string | undefined): string {
  return `ssh -N -L ${port}:127.0.0.1:${port} you@${host ?? 'your-server'}`
}

/**
 * The tunnel command to print beside the link, or nothing at all when this is
 * not a remote login.
 *
 * `SSH_CONNECTION` is "client address, client port, server address, server port",
 * so the third field is the address the person connected **to** — the one worth
 * putting in the command. `SSH_TTY` alone still means a remote login; there is
 * just no host to name, so the placeholder stands and the reader fills it in.
 */
export function remoteTunnelCommand(env: RemoteLoginEnv, port: number): string | undefined {
  const connection = (env.SSH_CONNECTION ?? '').trim()
  const tty = (env.SSH_TTY ?? '').trim()
  if (connection === '' && tty === '') return undefined

  const serverAddress = connection.split(/\s+/)[2]
  return tunnelCommandFor(port, serverAddress === '' ? undefined : serverAddress)
}

function hostForUrl(address: string): string {
  return address.includes(':') ? `[${address}]` : address
}

/**
 * The URL another device on the network can actually open, or `undefined` when
 * there is none.
 *
 * A loopback server has no such URL, and a wildcard bind on a machine with no
 * external interface has none either — so the field is absent rather than
 * guessed. A link that refuses the connection is worse than no link, because the
 * person holding the iPad has no way to tell which of the two ends is wrong.
 */
export function lanUrlFor(
  bind: string,
  port: number,
  hostAddresses: () => readonly HostAddress[],
): string | undefined {
  if (isLoopbackBind(bind)) return undefined
  if (!isWildcardBind(bind)) return `http://${hostForUrl(bind)}:${port}`

  const lan = hostAddresses().find((entry) => entry.family === 'IPv4' && !entry.internal)
  return lan === undefined ? undefined : `http://${lan.address}:${port}`
}

/**
 * The origin **this machine** can reach a server on, given the address it took.
 *
 * The mirror of `lanUrlFor`, which answers the other question — where someone
 * else's iPad should look. Loopback and wildcard both answer on `127.0.0.1`; a
 * server bound to one named interface answers only there, so that is what a
 * local client has to ask. A socket wants the literal `127.0.0.1`; the link a
 * person is handed says `localhost` instead, which is `humanUrlFor`'s business.
 */
export function localOriginFor(bind: string, port: number): string {
  if (isLoopbackBind(bind) || isWildcardBind(bind)) return `http://127.0.0.1:${port}`
  return `http://${hostForUrl(bind)}:${port}`
}

/**
 * The link to hand the person at **this machine**, given the address the server
 * took — the `url` every command prints.
 *
 * Same rule as `localOriginFor`, spelled for a browser: a loopback or wildcard
 * server answers on `localhost`; a server bound to one named interface answers
 * only there, so `localhost` would be a link to an address nothing listens on
 * at all. `lanUrlFor` stays the other device's link.
 *
 * This **describes** a bind and never chooses one. It is handed the address a
 * listening server already took — off its lock, or off the socket just opened —
 * and nothing reads its answer back to decide where a server binds. What a start
 * binds is `--bind`, else `DEFAULT_BIND`, and that is decided nowhere near here.
 */
export function humanUrlFor(bind: string, port: number): string {
  if (isLoopbackBind(bind) || isWildcardBind(bind)) return `http://localhost:${port}`
  return `http://${hostForUrl(bind)}:${port}`
}

/** The `lanUrl` member to spread into a result, or nothing at all. */
export function lanUrlMember(lanUrl: string | undefined): { readonly lanUrl?: string } {
  return lanUrl === undefined ? {} : { lanUrl }
}

/** ` · LAN http://…` for the human line, or nothing at all. */
export function lanUrlSuffix(lanUrl: string | undefined): string {
  return lanUrl === undefined ? '' : ` · LAN ${lanUrl}`
}

/**
 * ` · bound to <addr>` for the human line — on every start, without exception.
 *
 * The terminal is where a bind beyond loopback becomes visible to the person who
 * typed it, so the address is never left implicit, not even when it is the
 * default. A line that only mentions the address sometimes teaches the reader to
 * stop looking for it.
 */
export function boundToSuffix(bind: string): string {
  return ` · bound to ${bind}`
}
