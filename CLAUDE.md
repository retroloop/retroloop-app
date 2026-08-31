# Retroloop app

The Retroloop application: a local-first retrospective engine — CLI, server,
and review UI. The AI drafts session frictions as records; the human aligns and
decides in the browser; the outcome exports as versioned JSON.

## Layout

Bun workspace: `packages/core` (domain + stores), `apps/api` (tRPC server),
`apps/web` (review UI), `apps/cli` (the `retroloop` binary), `e2e/` (all-real
end-to-end suite), `scripts/` (repo tooling). Design docs live in
`docs/design/`; the export contract in `docs/export/`.

## Working rules

- **Run the tests:** `bun run test` (workspace suites) · `bun run e2e` ·
  `bun run gate` (the full verification gate: suites + headless
  zero-console-error check + mock-lock check). A change is done only when the
  gate passes.
- **Test, not debug** — a bug becomes a failing test at the lowest layer that
  can express it before any fix.
- **Dependency direction** — `core` imports nothing from siblings; `apps/*`
  import `core`/`api` downward only; `ui → api` is type-only
  (`docs/design/repo-layout.md`).
- **R-MOCK-LOCK** — `apps/web` mocks tRPC only via the single typed mock module
  derived from `AppRouter` (`apps/web/test/trpc-mock.ts`); no custom
  routers/handlers/HTTP mocks.
- **Actor invariants** — the AI actor can never write human fields; human data
  is append-only and versioned; decline is a state, not a deletion
  (`docs/design/architecture.md`).
- **Explicit approve only** — nothing is ever inferred from silence or absence
  of comments, anywhere in the product.
- **UI: every element earns its place** — critical path only; when in doubt,
  leave it out.
- **Never install a dependency version from memory** — bare `install`, then
  verify what actually landed.
