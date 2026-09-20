# Retroloop

**Turn the frictions from your AI sessions into permanent fixes — in a personalization plugin that exists just for you.**

In each AI session, you focus on your goal. The AI keeps running notes on everything that gets in the way. One command turns those notes into a reviewable retrospective: every issue with its evidence — including your own words from the moment it happened — a five-whys root cause, and solutions at increasing levels of strength, each showing exactly what would change in your personalization plugin. You pick the solution you prefer, choose your own level of involvement, and a team of agents implements the fixes. The next session starts on the newest version of your setup.

In this iterative process, each session becomes a trial, where the AI learns from its mistakes and patches its own personalization code to get better.

<!-- VIDEO EMBED SLOT — add when the install flow is live -->

## What's in this repository

The Retroloop app: the `retroloop` CLI the AI drives, the local always-on server, and the review UI where you and the AI align on every issue — approve, decline, or send back for revision, with comments on any part of the record. Local-first: your issues live on your machine; exporting to GitHub or other trackers is your choice.

- `packages/core` — the domain: retrospectives, records, reviews, the actor model (the AI drafts; you decide)
- `apps/cli` — the `retroloop` command-line interface (`retroloop --help` is the authoritative reference)
- `apps/api` — the local server
- `apps/web` — the review UI
- `e2e` — the all-real end-to-end suite

How it works and why: the design docs in `docs/design/`. The export contract: `docs/export/export.v1.schema.json`.

## Install

Retroloop installs through Claude Code, in three steps:

```
/plugin marketplace add retroloop/plugins
/plugin install retroloop@retroloop
/retroloop:setup
```

Setup clones this app into `~/.retroloop`, starts the local server, and creates your personalization plugin. Prerequisites and supported systems are in the [plugin README](https://github.com/retroloop/retroloop).

## Running from source

Requires [Bun](https://bun.sh).

```sh
bun install
bun run test              # every workspace suite
bun run retroloop up --json   # start the local server
bash scripts/gate.sh      # the merge gate: static, suites, headless check, mock lock
```

## License

[MIT](LICENSE)
