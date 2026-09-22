import { UsageError } from '#errors'

/**
 * The address a server takes — the only one it can take.
 *
 * The review server holds a human's frictions in their own words and has no
 * password of any kind, so the honest reach for it is the machine it runs on.
 * `--bind` still exists, and still binds the one start it was typed for, but the
 * only addresses it accepts are the ones that mean this machine. Everything else
 * is refused, and the way in from another computer is the secure-shell tunnel.
 */
export const DEFAULT_BIND = '127.0.0.1'

/** Where a spawned `serve` is told to listen. */
export type ServeAddress = {
  readonly port: number
  readonly bind: string
}

/** A literal `127.x.x.x`, all four parts numbers, none of them above 255. */
function isLoopbackIpv4Literal(host: string): boolean {
  const parts = host.split('.')
  if (parts.length !== 4) return false
  if (parts[0] !== '127') return false
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/**
 * Every spelling of "this machine only": 127.0.0.0/8, `::1`, and the name for
 * them.
 *
 * An **address** test, never a prefix of a string. What is checked here is
 * handed on to `Bun.serve` as a hostname, which resolves it — so `127.` as a
 * prefix would accept `127.evil.example.com`, a name whose owner decides which
 * interface it points at. On a rented server that can be the public one, and the
 * same reading would call it loopback and print a `localhost` link beside it:
 * exposed, and a link that lies about it. `localhost` is the one name allowed,
 * because the resolver is required to answer it with loopback.
 */
export function isLoopbackBind(bind: string): boolean {
  const host = bind.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  return host === 'localhost' || host === '::1' || isLoopbackIpv4Literal(host)
}

/** `0.0.0.0` and `::` mean "every interface" — which one that turns out to be is the question. */
export function isWildcardBind(bind: string): boolean {
  const host = bind.trim().replace(/^\[/, '').replace(/\]$/, '')
  return host === '0.0.0.0' || host === '::'
}

/**
 * Refuses every address that is not this machine, before anything is started,
 * written or locked.
 *
 * One rule, and no way round it: public, private and wildcard addresses are the
 * same refusal, there is no flag and no environment variable that unlocks one,
 * and nothing on disk can widen it. The reason is not that a named interface is
 * worse than a wildcard — it is that the page behind either has no password, so
 * an address is the whole of the protection, and on a rented server the one
 * address a machine has is the public one.
 *
 * Refusing without saying what to do instead is what the old message did, and it
 * pointed at the thing that caused the harm. This one names the tunnel: the port
 * forwarded over the secure login the person already has, which leaves the server
 * exactly where it is and still puts the page in their own browser.
 *
 * `port` is the port this stage would actually use — flag, environment variable,
 * or the port a running server holds — because a forwarding command for a port
 * nothing listens on is worse than no command at all.
 *
 * The command sits on a line of its own. A terminal draws no boundary round it,
 * so a comma written straight after `you@your-server` ends up inside the copy.
 */
export function requireLoopbackBind(bind: string, port: number): void {
  if (isLoopbackBind(bind)) return
  throw new UsageError(
    `--bind ${bind} is refused: the review server only ever listens on this machine.\n` +
      `To open it from another computer, forward the port over your SSH connection:\n` +
      `  ${tunnelCommandFor(port, undefined)}\n` +
      `then open http://localhost:${port}`,
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

/** The `tunnel` member to spread into a result, or nothing at all. */
export function tunnelMember(tunnel: string | undefined): { readonly tunnel?: string } {
  return tunnel === undefined ? {} : { tunnel }
}

/**
 * The line to print beside the link, or nothing at all.
 *
 * `--json` gets the `tunnel` field instead, never this sentence: a caller parsing
 * stdout wants the command, not an instruction wrapped round it.
 *
 * The command gets a line to itself, for the reason the refusal does: the reader
 * is going to select it with a double-click, and punctuation touching either end
 * travels with the selection.
 */
export function tunnelLine(tunnel: string | undefined, port: number): string | undefined {
  return tunnel === undefined
    ? undefined
    : `From your own computer:\n  ${tunnel}\nthen open http://localhost:${port}`
}

function hostForUrl(address: string): string {
  return address.includes(':') ? `[${address}]` : address
}

/**
 * The origin **this machine** can reach a server on, given the address it took.
 *
 * Every address a start can take now answers on `127.0.0.1`. The other two
 * branches survive because a lock file can still name what an older server bound
 * — a wildcard, or one named interface — and a reading of what is serving has to
 * be true about that server rather than about the rule it predates. A socket
 * wants the literal `127.0.0.1`; the link a person is handed says `localhost`
 * instead, which is `humanUrlFor`'s business.
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
 * at all — which only an older server's lock can still say.
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

/**
 * ` · bound to <addr>` for the human line — on every start, without exception.
 *
 * The address is never left implicit, not even now that it can only ever be this
 * machine: a line that only mentions the address sometimes teaches the reader to
 * stop looking for it, and the terminal is where a reader checks what is true.
 */
export function boundToSuffix(bind: string): string {
  return ` · bound to ${bind}`
}
