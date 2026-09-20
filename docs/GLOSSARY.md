# Glossary

- **Session** — one Claude Code working session, registered in Retro at start (integer id; the Claude UUID is an attribute). Owns notes and retrospectives.
- **Retrospective** — one capture-and-review cycle within a session. A session has 1..n; exactly one may be open. States: open → reviewing → finished. Readers are shown a fourth word, `submitted` — stored `reviewing` with the latest round finished, the window between the human's press and the AI's close — which is derived on every read and stored nowhere (`design/lifecycle.md`).
- **Revision** — the AI's immutable numbered draft of a retrospective's records. New feedback produces a new revision, never an edit.
- **Record** — one captured friction/observation inside a revision: problem, impact, verbatim human words, root-cause chain, agreed direction, defaults. Stable slug id, never renumbered.
- **Decision** — the human's explicit per-record verdict: pending · approved · declined. Only the human decides, only in the UI; silence is never approval. (`hold` was a fourth verdict once; stored ones still read, nothing writes new ones.)
- **Hold** — *removed.* It was a lifecycle flag on a record, orthogonal to its verdict, set and cleared by the human. What it expressed is **Involvement**: an item marked `interactive` or `pull-request` is one the solving side does not take without the human. The `holds` table and its rows stay as history; nothing reads or writes one.
- **Note (AI)** — an append-only friction note the agent files during the session via `retroloop note add`.
- **Note (human)** — an append-only note the human adds from the session page.
- **Annotation** — the human's one-shot remark on a single AI note. No threads; invisible to the AI until drafting.
- **Request** — *removed.* It was a top-level human ask on a review ("add X to the next revision"), answered by the AI and closed by the human. A **review-level comment thread** is the one ask channel now — one ask per comment. The `requests` table and its rows stay as history; nothing reads or writes one.
- **Event** — a domain event row appended in the same transaction as its write; the outbox every viewer (SSE, `review wait`) is fed from.
- **Root folder** — the one directory Retroloop owns (default `~/.retroloop`, selected with `--home` or `RETROLOOP_HOME`): `data/` the stage, `backups/db/` the pre-migration snapshots, `retros/` the exports.
- **Stage** — the data directory under the root (`<root>/data`) owning DB, config, port, logs, and the server lock. One server per stage.
- **Actor** — `ai` or `human`. The CLI always acts as `ai`; human-authored data is mechanically unwritable by the AI.
- **Review round** — one pass of human review over a retrospective's latest revision: the human decides every record and presses Finish. A further revision opens the next round; only the latest round counts (`design/lifecycle.md`).
