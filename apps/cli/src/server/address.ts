import { networkInterfaces } from 'node:os'

/**
 * The address a server takes when nobody asks for another one.
 *
 * Loopback, and said so out loud in `--help`. cli.md's design narrative once
 * promised "auto LAN"; a tool that quietly puts a review server on the network
 * because you did not name an address is not being helpful, it is deciding
 * something for you. `--bind` is how you ask, and `--help` is the authoritative
 * statement of what happens when you do not (KC-0021).
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
function isWildcardBind(bind: string): boolean {
  const host = bind.trim().replace(/^\[/, '').replace(/\]$/, '')
  return host === '0.0.0.0' || host === '::'
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
 * local client has to ask. Built from the lock rather than from `stage.url`,
 * whose `localhost` is right for a link to paste and wrong for a socket to open
 * against a LAN-only bind.
 */
export function localOriginFor(bind: string, port: number): string {
  if (isLoopbackBind(bind) || isWildcardBind(bind)) return `http://127.0.0.1:${port}`
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
