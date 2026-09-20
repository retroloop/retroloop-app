# Update

**Human-initiated only.** Retroloop is updated through its Claude Code plugin;
nothing updates itself. The AI may *suggest* an update — it never runs one.

## The chain

1. **Update the plugin** from Claude Code's own `/plugin` surface. The plugin
   carries the skills, not the app.
2. **Update the app** by re-running `/retroloop:setup`, which pulls this
   repository in place at `~/.retroloop/apps/retroloop` and re-runs
   `bun install`.
3. **Restart the server** — `retroloop down && retroloop up`. The old server
   exits cleanly on SIGTERM (tailer stops, DB closes); the new one takes the
   stage lock, writes a pre-migration snapshot under `<root>/backups/db/`,
   applies pending migrations, and listens.

## Why no race

CLI and server are one checkout, so they always carry the same migration code;
both take the same lock at startup and apply pending migrations idempotently. A
CLI command issued while the server is migrating waits on the lock, then finds
nothing pending. A CLI command that runs first migrates first, and the server
then finds nothing to do. See `docs/design/migrations.md`.

## Mismatch handling

- **Migrations are additive-first**, so a brief window in which an old process
  meets a new schema is safe by policy.
- **Rollback** is the pre-migration snapshot under `<root>/backups/db/` plus a
  checkout of the previous revision of the app.
