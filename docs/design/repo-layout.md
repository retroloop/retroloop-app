# Repo layout

Two repos: **`retroloop/retroloop-app`** (this one — the application) and **`retroloop/retroloop`** (Claude Code plugin; marketplace `retroloop/plugins`; target state, not yet created). Rationale: plugin installs clone the whole repo; the plugin must stay tiny and auditable; the CLI's `--json` surface is the only coupling.

## Tree (application repo)

```
retroloop-app/
├── docs/
│   ├── REQUIREMENTS.md              # consolidated, written after data model/UI/export settle
│   ├── design/                      # architecture, realtime, cli, migrations, testing, repo-layout, (data-model, trpc, ui, export — pending)
│   ├── runbooks/                    # install, update, (release — pending)
│   └── GLOSSARY.md
├── packages/
│   └── core/                        # domain ← application ← infrastructure; no sibling imports
│       ├── src/
│       │   ├── domain/              #   models/ events/ errors/ repositories/   (*.model.ts, *.error.ts, *.repository.ts)
│       │   ├── application/         #   ports/ schemas/ use-cases/ app.ts      (*.port.ts, *.schema.ts, *.use-case.ts)
│       │   ├── infrastructure/
│       │   │   ├── memory/          #   *.memory.adapter.ts — the only mock in the system
│       │   │   └── sqlite/          #   sqlite-store.adapter.ts, repositories/, migrator.ts, migrations/
│       │   └── index.ts             #   barrel
│       └── test/                    #   unit/ contract/ migrations/ concurrency/
├── apps/
│   ├── api/                         # trpc/ (context.ts TYPE, context.factory.ts, routers/ with .input() AND .output(), errors.ts)
│   │                                # events/ (tailer.ts, listeners/), static.ts, server.ts (composition root)
│   ├── web/                         # React 19 + Vite + TanStack Router/Query + shadcn + Tailwind v4
│   │                                # src/routes/ lib/(trpc.ts, live.ts) components/(ui/, review/, dashboard/)
│   │                                # features/ (web Gherkin over the typed mock), test/trpc-mock.ts (R-MOCK-LOCK)
│   └── cli/                         # yargs; commands/; guard.ts; output.ts; errors.ts; features/ (CLI Gherkin); build.ts
├── e2e/                             # all-real Gherkin: features/ steps/ fixtures/ playwright.config.ts
├── examples/import/                 # illustrative, unsupported import scripts reading export.v1
├── scripts/                         # install.sh, install.ps1, release.ts, make-migration.ts, check-mock-lock.ts
├── .github/workflows/               # ci.yml (3-OS matrix), release.yml — activates when a remote exists
├── package.json                     # workspaces: packages/*, apps/*
├── bunfig.toml  tsconfig.base.json  biome.json
├── CLAUDE.md
└── README.md
```

## Conventions

- **File naming:** `*.model.ts / *.use-case.ts / *.repository.ts / *.service.ts / *.port.ts / *.adapter.ts / *.error.ts / *.schema.ts`; no `I`-prefix; folders materialize with their first member.
- **Use cases:** one class per file, `execute(Input): Promise<Output>` with explicit DTO types; misses return `undefined`, never throw; typed domain errors; inputs validated once at the boundary.
- **Imports:** barrel-only across packages (`src/index.ts`); `#*` node subpath imports inside a package; `verbatimModuleSyntax` + `useImportType`.
- **Dependency direction:** `core` imports nothing from siblings; `api`/`cli` import `core`; `web` imports `api` **type-only** (`AppRouter`, context type split from value). Checked in CI/gate by a script (grep for value imports + Biome `noRestrictedImports`).
- **Never install a version from memory:** bare `install`, then verify what landed.

## Worktrees

- **Git worktrees live under `.claude/worktrees/<name>`** (gitignored), one per
  line of work, with the branch named after the folder. Nothing outside that
  folder is written by a worktree.
