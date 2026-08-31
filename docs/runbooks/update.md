# Update

**Human-initiated only** (`retroloop update`, or re-running `/retroloop:setup`). The AI may *suggest* an update when the hook sees a compat mismatch — it never runs one.

## The chain

1. **Check** the release channel within the plugin's compat range (`plugin.json`, e.g. `retroloop >=1.2 <2`); download to a temp file; verify checksum.
2. **`service stop`** — the old server exits cleanly on SIGTERM (tailer stops, DB closes).
3. **Atomic rename** of the new binary over the old one.
4. **`service start`** → new `serve` → backup → migrations under exclusive lock → tailer → listen.
5. **`doctor`** verifies; prints version + URL.

## Why no race

The binary is one artifact — CLI and server always carry the same migration code; both take the same lock at startup and apply pending migrations idempotently. A CLI command during step 4 waits on the lock, then finds nothing pending. A CLI landing between steps 2 and 3 migrates first; the server finds nothing to do. See `docs/design/migrations.md`.

## Mismatch handling

- **Hook:** binary version outside the plugin's compat range → one-line warning, suggest `/retroloop:setup`.
- **Doctor:** running server version ≠ on-disk binary version (hand-swapped binary, `brew upgrade` without restart) → WARN with "restart the service".
- **Migrations are additive-first**, so the brief old-server/new-schema window is safe by policy.
- **Rollback:** `retroloop restore` of the pre-migration backup, then reinstall the previous release (`retroloop update --version <v>`).
