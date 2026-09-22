# Architecture

Retro is a **local-first retrospective tool**: the AI drafts session frictions, the human aligns per record in a web UI, a durable local ledger keeps every revision forever, and a versioned JSON export hands off to whatever tracker the user already has.

## Layers

| # | Layer | What's in it | Has a fake? |
|---|---|---|---|
| **L0** | Platform | OS, filesystem, SQLite engine (`bun:sqlite`), launchd/systemd/Task Scheduler, network | No — always real; isolated per stage |
| **L1** | Storage adapters | `sqlite-store.adapter`, `*.sqlite.adapter` repositories, migrator + migrations | **Yes:** `memory` adapters — the only mock in the system |
| **L2** | Domain | models, errors, events, repository *interfaces* | No — pure |
| **L3** | Application | use cases (one class, `execute(Input): Output`), ports (`clock`, `id-gen`, `event-publisher`), zod schemas, `createApp` | Ports only: fake `Clock`, `IdGen` |
| **L4a** | Driving adapter: server | tRPC routers/context/error map, tailer, SSE, static serving, `serve()` composition root | Bypassed by `createCaller` in tests |
| **L4b** | Driving adapter: CLI | yargs commands, `--json` output, guard, exit-code map | Run as a real process |
| **L5** | Web UI | React SPA, tRPC client, `useLiveSession`, components | Mocked only at the typed tRPC link (R-MOCK-LOCK) |
| **L6** | Browser + transport | Chromium/WebKit, HTTP, SSE/EventSource | Headless real browsers; never a developer's everyday Chrome |
| **L7** | Distribution | compiled binary, `setup`, `service install`, `update`, plugin hooks | `--dry-run` service registration in CI |

## Two processes, one code, one database

- **The server** (`retroloop serve`, run by the boot service): serves UI + tRPC, holds every browser's SSE connection, runs the event tailer. One per stage.
- **The CLI** (`retroloop …`): short-lived process per command, **its own instance of the same App** over the same SQLite file. It never talks to the server; capture works even when the server is down.
- **The use-case layer is the only boundary** either adapter sees. CLI and tRPC never know core internals.
- **Concurrency by design, not protections:** WAL + `busy_timeout`; every use case is one `BEGIN IMMEDIATE` transaction; data is mostly append-only (revisions, comments, decisions, events = inserts); the few mutable rows carry optimistic `version` columns → typed `ConflictError`.
- **No authoritative in-memory state.** The server caches nothing about domain data; anything derived is keyed on `PRAGMA data_version`.

## Composition roots

- **Server composition root: the CLI's `serve` command** (apps/cli, composing
  apps/api's `createServerRuntime`/`startServer`): stage lock first, then
  `openStore() → createApp(store) → createTailer(store, app) → createRouter(app, tailer) → Bun.serve`;
  `SIGTERM/SIGINT → tailer.stop(); server.stop(); store.close()`. It lives in the
  CLI because the lock must be taken before anything opens the store; a
  duplicate `serve()` in apps/api had no production caller and was removed.
- **CLI `main.ts`** (apps/cli): `createApp(openStore())` + yargs. **No tailer in the CLI** — `review wait` polls the events table itself.
- **No DI container** — explicit construction at the two roots only.

## Stages

- **One root folder** (default `~/.retroloop`; select with `--home <root>` or `RETROLOOP_HOME`). Everything Retroloop owns hangs off it: the stage at `data/`, pre-migration snapshots at `backups/db/`, exports at `retros/`.
- **A stage = a data directory** (`<root>/data`). Each stage owns `retro.db`, `config.json` (port, bind), logs, and **`server.lock`**.
- **One server per stage:** `serve` takes an OS-level lock on `server.lock` (PID + port inside). A second `serve` on the same stage exits code 7. Different stage → different port → separate instance. Tests use throwaway stages on random ports.

## Server lifecycle

- **`setup`** initializes the stage, runs migrations, installs + starts the boot service (launchd today; `systemd --user` / Task Scheduler are target state), verifies the URL, prints it.
- **`up` / `down`** — idempotent: `up` ensures the service (or a detached `serve`) is running and prints the URL; `down` stops it. What humans, hooks, and skills actually call.
- **`serve`** — low-level foreground command; what the service executes. Applies pending migrations under the write lock before listening.
- **Network:** default port **24100**, bound to **this machine only** — every other address is refused by `up` and `serve` alike, with no flag or environment variable that opens one, because the review page has no authentication and an address would be the whole of its protection. Reviewing a remote server is an SSH port forward, which a start inside an SSH session prints beside the link. Never 5000/7000 (macOS AirPlay). Nothing ever leaves the machine.

## Update chain (human-initiated; the AI may suggest, never run)

1. Check the release channel within the plugin's compat range; download to temp; verify checksum.
2. `service stop` — old server exits cleanly (SIGTERM).
3. Atomic rename of the new binary over the old.
4. `service start` → new `serve` → **backup → migrations under exclusive lock → tailer → listen**.
5. `doctor` verifies; prints version + URL.

**Why there is no migration race:** the binary is one artifact, so CLI and server always carry the same migration code. Both do the same on startup: take the lock, apply pending, release. A CLI command during step 4 waits on the lock, then finds nothing pending. A CLI that lands between 2 and 3 migrates first; the server then finds nothing to do. Hand-swapped binaries are caught by `doctor` ("running server version ≠ binary version"); the additive-first migration rule covers the short window.

## Actor model — the mechanical human-data guarantee

- **Two actors:** `ai` and `human`. The CLI always acts as `ai`; the browser acts as `human`.
- **There are no human-decision commands in the CLI.** Approve / decline / revise
  / finish / human comments / human notes / annotations exist only in the UI.
  `retroloop review close` is not one of them: it decides nothing, it refuses
  unless the human has already finished *that* revision with every record
  decided and none asking to be rewritten, and it is closed to the `human`
  actor — so the browser cannot reach it even if a procedure were added by
  mistake.
- **Enforcement lives in the use cases** (L3): every use case takes an `Actor`; human-owned writes throw `ForbiddenActorError` for `ai`. It holds for every adapter because it is below all of them.
- **Backstop at L1:** human-authored tables (comments, notes, annotations, decisions, holds) are **append-only with SQLite triggers rejecting `UPDATE`/`DELETE`** — the guarantee holds even against a rogue writer opening the DB directly.
- **`ReviewFinished` closes every human write, with no exceptions.** `holds.set` and `holds.clear` were reachable on a finished retrospective for a time and went with the hold feature when it was removed. One function, `refuseWhenFinished`, is what every human write calls, and `review.test.ts` enumerates them.
- **Nothing is ever lost:** revisions are immutable; decline is a state, not a deletion; human notes are versioned per revision and viewable as written.

## The plugin repo (target state — not yet created)

- **`retroloop/retroloop`** — Claude Code plugin (marketplace: `retroloop/plugins`): `.claude-plugin/plugin.json`, `skills/review/SKILL.md`, `skills/setup/SKILL.md`, `hooks/*.sh`. Hooks are plain `.sh` files that may call the CLI; no OS logic beyond that.
- **One-direction coupling:** the plugin calls `retroloop … --json`; the CLI's `--json` shapes are the versioned public API (breaking them = major version); `plugin.json` pins a compat range. The app never knows the plugin exists.
