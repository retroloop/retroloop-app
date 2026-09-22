# Install & onboarding

Retroloop is installed through its Claude Code plugin. The plugin carries the
skills; the setup skill installs this app, starts the local review server, and
creates the personalization plugin.

## Onboarding flow (all OSes)

1. **Install the plugin**, in Claude Code:

   ```
   /plugin marketplace add retroloop/plugins
   /plugin install retroloop@retroloop
   ```

2. **Run the setup skill:** `/retroloop:setup`. It asks for consent before every
   step that installs anything — nothing installs itself, and the SessionStart
   hook only ever points at the setup skill when it finds the app missing.
3. Setup requires [Bun](https://bun.sh), and git, curl and unzip with it. It
   checks all four first and can install what is missing, but only on your yes:
   it works out how software is installed on this machine, proposes the exact
   commands, and stops with what to ask IT for when the machine's rules block
   them.
4. Setup clones this repository into the root folder at
   `~/.retroloop/apps/retroloop`, runs `bun install`, and verifies the CLI
   answers `retroloop --version`.
5. Setup then starts the server with `retroloop up --json` and verifies the URL
   it prints actually serves the review page. `up` builds that page first when it
   is missing or older than the code, so there is nothing to build by hand.
6. From then on: `/retroloop:review` when a session winds down; `retroloop up`
   is the idempotent "make sure it's running".

If the app is cloned somewhere other than the default, `RETROLOOP_APP` in the
environment points at that directory. Nothing is written to disk to remember the
choice, so without that variable the hook looks only in the default location.

## Stages

- **The app never lives inside the plugin tree.** Claude Code replaces that tree
  on update, so the checkout sits under the root (`~/.retroloop/apps/…`) and the
  data in the stage — neither is anything an update can overwrite.
- **One root folder** (default `~/.retroloop`): `apps/` the app checkout,
  `plugins/` the personalization plugins, `data/` the stage, `backups/db/` the
  pre-migration snapshots, `retros/` the exports. Select another root with
  `--home <root>` or `RETROLOOP_HOME` (e.g. a test root on its own port).
- **A stage = a data directory** (`<root>/data`): `retro.db`, `config.json`,
  logs, `server.lock`. One server per stage, enforced by the lock.

## Where the server listens

The server listens on `127.0.0.1` and nowhere else. Every other address is
refused by `up` and by `serve` alike — public, private and wildcard alike — and
there is no flag or environment variable that opens one. The review page has no
password, so an address would be the whole of its protection, and on a rented
server the one address a machine has is the public one.

## Reviewing a server you log into

Forward the review port over the SSH connection you already have, and open the
page on your own machine:

```sh
ssh -N -L 24100:127.0.0.1:24100 you@your-server
```

Then open `http://localhost:24100`. Leave that command running for as long as
you are reviewing; `Ctrl-C` ends it.

If you already run Retroloop on your own machine, port 24100 is busy there, so
forward the remote port to a different local one — the page asks its server for
data at a relative address, so any local port works:

```sh
ssh -N -L 24200:127.0.0.1:24100 you@your-server   # then open http://localhost:24200
```

Retroloop prints that command for you: start it inside an SSH session and the
line beside the link is the command to paste on your own computer, with the
port and the host already filled in.
