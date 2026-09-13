# Install & onboarding

> **Target state — the plugin repo (`retroloop/retroloop`) and GitHub Releases do not exist yet.** Today: build locally (`bun install && bun run build`), then `retroloop up`. This runbook describes where onboarding lands.

## Onboarding flow (all OSes)

1. **Install the plugin:** `/plugin marketplace add retroloop/plugins` → `/plugin install retroloop` → reload plugins.
2. **First run:** the SessionStart hook (`.sh`, may call the CLI) detects the binary is missing and prints one line: "run `/retroloop:setup`". Hooks never install anything themselves — installing requires the human's consent.
3. **`/retroloop:setup`** (with consent) runs the install script for the OS: download the release asset for platform/arch **within the plugin's compat range**, verify checksum, place at `~/.ai-team/bin/retroloop` — then `retroloop setup`.
4. **`retroloop setup`:** initialize the root folder (`~/.retroloop`) and the stage under it (`~/.retroloop/data`), apply migrations, install the boot service, start it, verify the URL over IP and hostname, print it.
5. From then on: `/retroloop:review` at any checkpoint; `retroloop up` is the idempotent "make sure it's running".

## Per-OS notes

| | macOS | Linux | Windows |
|---|---|---|---|
| Binary | darwin-arm64 / x64 | linux-x64 / arm64 | windows-x64 |
| Boot service | launchd LaunchAgent | `systemd --user` | Task Scheduler logon task |
| Install script | `install.sh` (curl) | `install.sh` | `install.ps1` (irm) |
| LAN hostname | `hostname.local` (mDNS) | needs avahi — IP URL always printed too | mDNS on Win10+ |
| Convenience (later) | Homebrew tap | Homebrew tap | Scoop bucket |

- **Primary distribution is the GitHub Release binary** — works everywhere with one command, no runtime required. brew/scoop/npm wrappers are later conveniences installing the same artifact.
- **Never run from the plugin directory:** Claude Code replaces the plugin tree on update; the binary lives at `~/.ai-team/bin`, data in the stage.

## Stages

- **One root folder** (default `~/.retroloop`): `data/` the stage, `backups/db/` the pre-migration snapshots, `retros/` the exports. Select another with `--home <root>` or `RETROLOOP_HOME` (e.g. a test root on its own port).
- **A stage = a data directory** (`<root>/data`): `retro.db`, `config.json`, logs, `server.lock`. One server per stage, enforced by the lock.

## Diagnosis

- **`retroloop doctor`** is the only diagnostic surface: data dir, DB integrity, migrations, service status, version match, port reachability over IP and hostname, last backup age. `--fix` applies safe fixes.
