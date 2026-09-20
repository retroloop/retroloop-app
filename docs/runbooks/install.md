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
3. Setup requires [Bun](https://bun.sh); it checks for it and stops with install
   instructions rather than installing it.
4. Setup clones this repository into the root folder at
   `~/.retroloop/apps/retroloop`, runs `bun install`, and verifies the CLI
   answers `retroloop --version`.
5. Setup then starts the server with `retroloop up --json` and verifies the URL
   it prints actually serves the review page.
6. From then on: `/retroloop:review` when a session winds down; `retroloop up`
   is the idempotent "make sure it's running".

If the app is cloned somewhere other than the default, `RETROLOOP_APP` in the
environment points at that directory. Nothing is written to disk to remember the
choice, so without that variable the hook looks only in the default location.

## Stages

- **One root folder** (default `~/.retroloop`): `apps/` the app checkout,
  `plugins/` the personalization plugins, `data/` the stage, `backups/db/` the
  pre-migration snapshots, `retros/` the exports. Select another root with
  `--home <root>` or `RETROLOOP_HOME` (e.g. a test root on its own port).
- **A stage = a data directory** (`<root>/data`): `retro.db`, `config.json`,
  logs, `server.lock`. One server per stage, enforced by the lock.

## Binding

The server binds `127.0.0.1` unless asked otherwise. Reviewing from another
device on the same network is an explicit choice, made by the human:
`retroloop down && retroloop up --bind <this machine's LAN IP>`. Wildcard
addresses such as `0.0.0.0` are refused.
