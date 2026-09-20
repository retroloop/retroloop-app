# CLI interface

> **AUTHORITY (owner decision 2026-08-24, KC-0021 / fix-lane F4):** the
> authoritative reference for what the CLI actually does is **`retroloop --help`**
> and each command's own `--help` — generated from the shipped yargs
> definitions and the core enums, so it cannot drift from behavior. Everything
> below is **descriptive design narrative**: intended shape, future commands,
> rationale. Where this file and `--help` disagree, `--help` wins; a
> divergence is a bug only if the *behavior* is wrong, not the prose. No tests
> parse this file.

The binary `retroloop` serves two audiences: **the AI** (via the plugin skill — always `--json`) and **the human/admin** (setup, service, data safety). Hooks and the Claude plugin are separate (`.sh` files that may call this CLI); nothing here depends on them.

## Conventions

- **Addressing:** integer ids everywhere. `--retro <id>` is the primary address; `--session <id|uuid>` is accepted as a convenience meaning "the active retrospective of that session" (the Claude session UUID is an attribute used once at registration). A session has 1→n retrospectives, **exactly one open at a time**; a retrospective has 1→n revisions (numbering restarts per retrospective).
- **Lifecycle is implicit:** `revision create` starts a new retrospective if the last one is `finished`, otherwise adds a revision to the open one. `ReviewClosed` — `retroloop review close`, after the human's `ReviewFinished` — closes it (retro 4 `r-one-finish-button`).
- **`--json` everywhere:** one JSON object on stdout; errors as `{"error":{"code","message"}}` on stderr.
- **Actor:** the CLI always acts as `ai`. **No human-decision commands exist** — approve/decline/revise/finish/human comments/notes/annotations are UI-only. `review close` is not one: it decides nothing and refuses unless the human has already finished the round.
- **Idempotency:** `session create` is idempotent by session UUID; `revision create` takes `--expect-revision <n>` for an optimistic check.
- **Migrations are invisible:** applied automatically at startup by whichever process runs first, under the write lock. Status shows in `doctor`; `make:migration` is a dev script in the repo, not a binary command.
- **Globals:** `--json`, `--home <root>` (default `~/.retroloop`), `--quiet`; env `RETROLOOP_HOME`, `RETRO_PORT`, `RETRO_TEST_CLOCK` (tests only). `--home` and `RETROLOOP_HOME` name the **root folder**, not the stage: the stage is `<root>/data`, pre-migration snapshots go to `<root>/backups/db`, exports to `<root>/retros`. A relative value resolves from the caller's cwd. The older `RETRO_HOME` named the data directory and is not read anywhere.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | ok |
| 1 | unclassified error |
| 2 | usage |
| 3 | not found |
| 4 | conflict (stale version / `--expect-revision` failed) |
| 5 | forbidden (actor rule) — **and, since session 10, the AI-config-write switch**: `label`/`attribute` writes are refused while the human has it off (`AiConfigWriteDisabledError`, same `FORBIDDEN_ACTOR` code) |
| 6 | pending migrations (should not occur — see conventions) |
| 7 | service/server problem (already running, unreachable, wait timeout) |

## Designed command surface (descriptive — includes future commands)

The block below is the *designed* top-level surface, not the shipped one; run
`retroloop --help` for what exists today. Unshipped commands here (`setup`,
`doctor`, `down`, `service`, `update`, `open`, `config`, `backup`, `restore`,
`schema`, several sub-actions) are Tier-2/3 design.

```
retroloop — local-first retrospectives: AI drafts, human aligns, JSON exports

Usage: retroloop <command> [options]

Setup & service
  setup                  Initialize data dir, run migrations, install and start the service
  doctor                 Check data dir, database, migrations, service, port, versions
  up                     Ensure the server is running (idempotent); print the URL
  down                   Stop the server
  serve                  Run the server in the foreground (what the service runs)
  service <action>       install | uninstall | start | stop | restart | status
  update                 Update the binary to the latest compatible release
  open                   Print or open the dashboard / a retrospective's review URL
  config                 Show effective configuration

Data
  backup                 Snapshot the database to a file
  restore                Restore the database from a backup

Retrospective (AI-facing; use --json)
  session <action>       create | get | list | messages
  note <action>          add | list
  revision <action>      create | get | list
  review <action>        status | wait | close | list
  record <action>        list | queue | get | relations | history | claim | unclaim
                         | resolve | reopen | archive | unarchive | relate | unrelate
  comment <action>       add | list
  label <action>         list | create | rename | retire | unretire
  attribute <action>     list | create | rename | retire | unretire
  export                 Export a retrospective or project as json | md | toon
  schema <name>          Print the JSON schema for revision | export

Global options
  --json                 Machine-readable output on stdout; errors as JSON on stderr
  --home <root>          Retroloop root folder        [default: ~/.retroloop]
  --quiet                Suppress non-essential output
  --version | --help
```

## Designed command help (descriptive — includes future commands)

Same status as above: design narrative. Options, defaults, and enums for
shipped commands are authoritative only in each command's `--help`.

```
retroloop setup

Initialize ~/.retroloop and the stage under it, apply migrations, install the
boot service for this OS, start it, verify the URL over IP and hostname, print
the URL. Safe to re-run.

Options:
  --port <n>            Server port                          [default: 24100]
  --bind <addr>         Address to bind. A specific interface IP (e.g. 192.168.1.9)
                        exposes the server on that network; 0.0.0.0 and :: are
                        refused.                             [default: 127.0.0.1]
  --no-service          Initialize only; do not install or start the service
  --json
```

```
retroloop doctor

Run every health check, PASS/WARN/FAIL per item: data dir writable, PRAGMA
integrity_check, migration status, service installed/running, server version vs
binary version, port reachable over IP and hostname, last backup age.

Options:
  --fix                 Apply safe fixes (start service, run pending migrations)
  --json
```

```
retroloop up

Idempotent "make it run": if the boot service is installed, ensure it is started;
otherwise start a detached serve for this stage. If already running, do nothing.
Always prints the URL. Exit 7 only if the server cannot be brought up.
Binds 127.0.0.1 unless --bind names an interface address, which applies to that
start alone: no address is carried over from a previous one.

Options:
  --port <n>  --bind <addr>  --json
```

```
retroloop down

Stop the server for this stage (service stop, or kill the detached serve).
Idempotent.

Options:
  --json
```

```
retroloop serve

Run the server in the foreground. Takes the stage lock (server.lock — exit 7 if
another instance holds it), applies pending migrations under the write lock,
starts the event tailer, serves UI + API, stops cleanly on SIGTERM.

Options:
  --port <n>            [default: 24100]
  --bind <addr>         Address to bind. A specific interface IP (e.g. 192.168.1.9)
                        exposes the server on that network; 0.0.0.0 and :: are
                        refused.                             [default: 127.0.0.1]
  --home <root>
```

```
retroloop service <action>

Actions:
  install               Register the boot service for the current user
  uninstall             Remove it
  start | stop | restart
  status                Running? PID, port, uptime, log path

Options:
  --dry-run             Print what would be written/executed (used by CI)
  --json
```

```
retroloop update

Download the newest release within the compatibility range, verify checksum,
stop the service, swap the binary atomically, start the service (which migrates
under lock), run doctor. Human-initiated only.

Options:
  --check               Report available version; change nothing
  --version <v>         Install a specific version
  --json
```

```
retroloop open [--retro <id> | --session <id|uuid>]

Print the dashboard URL, or the review URL for a retrospective. With --browser,
open it in the default browser.

Options:
  --retro <id>  --session <id|uuid>  --browser  --json
```

```
retroloop config

Print the effective configuration (data dir, port, bind, service type, log path)
and where each value came from (flag, env, file, default).

Options:
  --json
```

```
retroloop backup

Write a consistent snapshot of the database (VACUUM INTO) to a file.

Options:
  --out <file>          [default: <stage>/backups/retro-<timestamp>.db]
  --json
```

```
retroloop restore <file>

Stop the server, replace the database with the backup, run migrations, start the
server. Asks for confirmation unless --yes.

Options:
  --yes
```

```
retroloop session <action>

Actions:
  create                Register a session (idempotent by --claude-session UUID)
  get                   Show one session, its notes summary and retrospectives
  list                  List sessions
  messages              Extract the human's messages from the session transcript

Options (create):
  --claude-session <uuid>                                              [required]
  --project <name>      Optional since N2 (KC-0020) — nothing builds on it
  --cwd <dir>                                                          [required]
  --branch <name>
  --supervised          Interactive, human-attended session
  → returns { sessionId, url }
Options (get | messages):
  --session <id|uuid>                                                  [required]
  --out <file>          messages: write instead of printing
Options (list):
  --project <name>  --status <active|reviewing|finished>  --limit <n>
  --json
```

```
retroloop note <action>

Frictions captured as they happen. Append-only; shown live in the session view.
The AI reads human notes and annotations only when drafting a revision.

Actions:
  add                   Append an AI note
  list                  List notes for a session

Options:
  --session <id|uuid>                                                  [required]
  --text "<note>"       add: inline text (or --file; - for stdin)
  --kind <k>            add: human-cost | ai-cost              [default: human-cost]
  --with-human          list: include human notes and annotations (draft time only)
  --json
```

```
retroloop revision <action>

A revision is the AI's immutable draft: records with problem, impact, verbatim
human words, root-cause chain, one to three proposed solutions, proposed
defaults. Human decisions and comments attach to a revision; the AI can never
alter them. (Records filed before the multi-solution shape carry one agreed
direction and one footprint instead, and are read back that way forever.)

Actions:
  create                Submit a new revision from a file
  get                   Show a revision with ALL human feedback on it
  list                  List revisions of a retrospective

Options (create):
  --session <id|uuid>   Starts a new retrospective if the last one is finished
  --file <path>         JSON matching `retroloop schema revision`          [required]
  --expect-revision <n> Exit 4 unless the next number is n
  → returns { retroId, retro, revision, url }
Options (get):
  --retro <id>          [or --session]
  --revision <n>        [default: latest]
  --feedback-only       Only decisions and comments (no record bodies)
  → both forms print a top-level `state`: the retrospective's STORED state
    (open | reviewing | finished), never `submitted` — see `review status`
Options (list):
  --retro <id>
  --json
```

```
retroloop review <action>

Actions:
  status                Counts by state for the active revision; where the round stands
  wait                  Block until the human finishes his side of the round
  close                 Close the review to export — the AI's act, after the wait
  list                  Read the stage's rounds; --finished is the only list today

Options:
  --retro <id>          [or --session <id|uuid>]
  --any                 wait: the next finish on ANY retrospective of this stage
                        (no --retro/--session; refuses --timeout 0)
  --finished            list: every retrospective whose LATEST revision is finished
  --timeout <seconds>   wait: exit 7 on timeout                      [default: none]
  --follow              wait: subscribe to the server's live events; falls back to
                        polling the store, and says which in `via`
  --json                status prints { retroId, state, finished, revision, counts }
                        wait prints the terminating event:
                        { kind: "ReviewFinished", retroId, revision, at }
                        wait --any prints the round and whose it was:
                        { retroId, retro, sessionId, finishedAt }
                        close prints { retroId, state, revision, finishedAt }
                        list --finished prints an array, oldest first:
                        [{ retroId, retro, sessionId, claudeSession, finishedAt,
                           closed, counts }]
```

**`status.state` is the displayed reading, and `status.finished` is not.** The
field carries four words — `open`, `reviewing`, `submitted`, `finished` — and
`submitted` is the one with nothing stored behind it: the human has finished the
latest round and the AI has not closed the retrospective yet, which is exactly
the window the AI is standing in when it runs this after `review wait`
(`design/lifecycle.md` §submitted). `finished` beside it still answers the stored
terminal state, so it is `false` through the whole of that window and a script
that keys off the boolean reads what it always read. `close` prints the
retrospective's own state, which is `finished` or the command failed.

**One field name, two answers, on purpose.** `revision get --json` also prints a
top-level `state`, and that one is the retrospective's *stored* state — three
values, `submitted` never among them. The two commands are asked different
questions: `revision get` is addressed to a revision and reports the row its
retrospective is in, while `review status` is the command that answers where the
round stands. The split is deliberate rather than an oversight, and it is on the
retro-16 list as a taste question for the owner.

**One outcome, and then a decision of your own** (retro 4 `r-one-finish-button`).
`wait` used to end on one of two events, because the page had one button per
event; the owner removed the second — *"it should be clear from the content of
the comments rather than from a redundant button I can press wrong"* — so `wait`
ends on `ReviewFinished` and the AI reads the round to know what it was:
`review status` counts the `revise` verdicts, `comment list --unanswered` names
the threads still waiting. Something open means the next revision; nothing open
means `review close`.

`close` is the only act the AI has ever had on a review and it decides nothing:
exit 4 unless the human finished *that* revision, every record is decided, and no
record carries `revise`. It is what makes a retrospective `finished`, and so what
makes `retroloop export` possible.

**`--any` and `list --finished` are for the agent that owns no retrospective.**
Both other forms need an address, which a caller only has when it filed the
revision itself — so a watcher that did not was reduced to polling `review
status` per retrospective, and one that started after the press had nowhere to
look at all. `wait --any` is the forward question: block until the human finishes
a round on **any** retrospective of this stage. `list --finished` is the backward
one: every round already put down, `closed` saying whether the AI has closed it.

**Finished means the latest revision.** Everywhere in this block: the human
pressed Finish on the retrospective's newest revision, which he cannot do while a
record is undecided. A round he finished and the AI answered with a new revision
is not finished any more — `wait --any` steps over that event and `list
--finished` does not list the retrospective, because it is back with him.

**Only a finish after the command started counts**, and that is why the two are
separate commands rather than one flag. `wait --retro` starts from the revision
it is waiting on, to close the race between `revision create` and `review wait`;
`--any` has no revision to start from, and starting from "the beginning" would
return instantly on any stage with history. Its window opens at the outbox head,
so `--timeout 0` is exit 2 rather than an answer of "nothing" — the question
about the past is `list --finished`. `--follow` is accepted and reports
`via: "store"`: the server streams per retrospective (`events.onRetro`) and there
is no stream for the whole stage, so this form polls, and says so rather than
degrading quietly.

`retro` in both shapes is the "Retro #n" of the identity line — the
retrospective's position within its session, not its id. `counts` in a `list`
row is the object `review status` prints.

```
retroloop record <action> [rid] [to]

Actions:
  list                  Records of a revision with their current state
  queue                 Every approved, unresolved record of every finished
                        retrospective, oldest first — the work
  get <#globalId>       One record in the queue's shape, plus its retrospective
  relations <#globalId> Every relation in force on it, both directions, each with
                        the far record's state and references
  history               One record across all revisions (what changed, decisions per revision)
  claim <#globalId>     Say you are working on it; exit 4 if somebody already is
  unclaim <#globalId>   Give it back; exit 4 if nobody is holding it
  resolve <rid>         Mark a record fixed, citing what shows it (the AI's act)
  reopen <rid>          Take that back — the fix did not hold
  archive <rid>         Human-only; offered here and refused with exit 5, on purpose
  unarchive <rid>       The same
  relate <from> <to>    Say two records belong together, in your words
  unrelate <from> <to>  Take that back; the row keeps the words it takes off

Options:
  --retro <id>          [or --session] — refused on the lane acts and on
                        relate/unrelate, see below
  --revision <n>        [default: latest]; refused on every write and on --all
  --record <rid>        history: stable record slug                    [required]
  --all                 list: every record of every retrospective instead of one
                        revision's; refuses --retro/--session/--revision
  --text <substring>    list --all: case-insensitive match on the title, the slug,
                        the problem and the root cause
  --state <s>           list: pending | approved | declined | revise | hold
                        | in-progress | resolved | archived
                        (`revise` is the third verdict, retro 4
                        `r-verdict-revise` — the records the next revision must
                        address; `hold` is a pre-`r-hold-semantics` verdict,
                        read-only history, and the `held` / `holdNote` fields
                        that rode beside it went with retro 4 `r-remove-hold`.
                        The last three are lane states and need `--all`)
  --ref <r>             resolve: repeatable; at least one is required
  --note <text>         resolve/reopen/archive: offered, never demanded
  --how <words>         relate: how the two relate            [required on relate]
  --json
```

**The lane is `queue`, `get`, `relations` and `list --all`, and they answer with
one row shape.** The queue is every **approved**, **unresolved**, not-archived
record of every retrospective whose latest round the human **finished** — the
three clauses that make it work rather than a listing. A record somebody has
claimed stays on it, marker showing, because whoever reads the queue needs to see
what is in progress. `--json` gives a bare array for `queue` and `list --all`,
one row plus `retrospective` for `get`:

```
{ recordId, retroId, retro, sessionId, title, slug, problem,
  rootCause { whatHappened, whys, root },
  diagnosticData,
  humanWords [ { verbatim, cleaned, context } ],
  workaround,
  ownerWords [ … ],
  selectedSolution { index, level, title, body, footprint [ … ] },
  involvement,
  relations [ { recordId, kind, direction } ],
  claim null | { claimedAt, actor },
  resolved,
  lifecycle { state, resolvedAt, ref, refs, claimedAt } }
```

`ownerWords` is the human's reviewer note first and then his comments on the
record, oldest first — his instructions in one field, so an agent can act on a
queue row without opening the review page. **`humanWords` is a different thing:**
the record's own quotes, what he said in the session the record was drafted
from, copied off the record beside its `workaround` (`"none"` when there was
none) — so `[]` under `humanWords` means he said nothing quotable, and `[]` under
`ownerWords` means only that he wrote no note and no comment. `context` is `null`
on a quote that has none, and `diagnosticData` is `null` on a record filed before
the field existed. `record get` prints both in its text form, under their own
names; the one line per record that `queue` and `list --all` print carries no
narrative at all. `lifecycle.state` is the **lane
state**: the verdict, the lifecycle and the claim folded into one word
(`lifecycle.md`). `record relations <#globalId>` prints
`[{ recordId, retroId, retro, slug, title, kind, direction, state, resolvedAt, ref, refs }]`,
where those last four are the **far** record's — and a far record a later draft
withdrew is still listed, with its rid for a title and `null` for its state,
because the row was written about a record that existed.

**`claim` and `unclaim` are the in-progress marker** (`data-model.md` §Record
claims). `claim` is exit 4 if somebody is already holding the record or if it is
not open; `unclaim` is exit 4 if nobody is holding it; **`record resolve` clears
the claim on its own**, in the same unit of work, so the ordinary path is claim →
fix → resolve and `unclaim` is for work that was started and put down. Both print
`{ recordId, retroId, slug, version, claim }`.

**`get`, `relations`, `claim` and `unclaim` take the `#globalId`**, like
`relate`, and refuse `--retro`/`--session`/`--revision`/`--state`/`--ref`/
`--note`/`--how` — the queue hands out numbers, and a number needs no
retrospective to be read in. **`record list` without `--all` is unchanged**: same
shape, same order, same answer.

**`relate` and `unrelate` are addressed by `#globalId`, and that is the whole
shape of them** (the owner, session 11: *"both actors can relate records, each
relation carries how-they-relate words, and the relation reads from both sides,
so that AI can easily find past records and build holistic solutions."*). A
relation names **two** records and `(retro, rid)` is the address of one, so the
two arguments are the numbers `record list` puts first — list, then relate the
numbers. `--retro` and `--session` are **refused** on both: a global number needs
no retrospective to be read in, and accepting one would suggest a relation lives
inside a retrospective when the point is that it crosses them.

**`--how` is required on `relate` and refused on `unrelate`.** The words are half
the act, and the row an un-relate writes carries **forward** the words of the
relation it takes off — so there is nothing a second set could be about, and the
history never holds two accounts of one relation.

**The read-back is `record list --json`**, where every row carries a `relations`
block: each entry names the other record's `globalId`, its `retroId` and `rid`,
the words, the direction (`outgoing` / `incoming`) and who wrote it. That is the
address every other read here takes, so following a relation into a retrospective
that closed sessions ago is `record list --retro <retroId>` with what is already
in hand. It is also the check after a batch: a listing silent about writes reads
exactly like a store that refused them (#103 `r-lifecycle-projection-gap`).

**Both actors may relate, and both may un-relate** — this and the lifecycle pair
are the only writes in the product open to both. There is no `--actor`: the CLI
writes as `ai` and nothing else, and the human's half is the browser's.

```
retroloop label <action> [name]

The label vocabulary — global, and the AI's half of the settings page. A label is
a name a record wears, or does not; nothing travels with it (the owner: *"usually
labels are just labels"*).

Actions:
  list                  Every label, retired ones included, in minting order
  create <name>         Create one
  rename <name> --to    Rename one; every record wearing it reads the new name
  retire <name>         Stop offering it. Never a delete — see below
  unretire <name>       Offer it again. The same row, nothing else changed

Options:
  --to <name>           rename: the new name                          [required]
  --json

**Definitions are addressed by name, case-insensitively**, because what an agent
has in hand is the word it read in `label list`. The `--json` answers carry an
`id` too; nothing here needs one.

**The four writes are gated by a switch on the human's settings page, and it
starts off** (OWNER RULING 2: *"if it is disabled, the user can be certain that
the AI cannot mess around"*). With it off they exit **5** with
`error.code = FORBIDDEN_ACTOR` and a message naming the setting and saying a
human turns it on. This is the one place in this whole surface where an exit 5 is
a real answer rather than a bug — the check is in core, at the store boundary, so
it holds whatever transport arrives.

**Retiring is not deleting.** The row stays, the name stays taken, and every
record already wearing the label goes on wearing it.

**And it is reversible** (retro-11 `r-retire-burns-a-word`): `unretire` offers
the same row again, keeping its id, its name and its creation time, and the name
was never freed in between — so bringing one back can never collide with
anything. Un-retiring what is not retired is a **4**, the mirror of a second
retire.

**There is no way here to put a label on a record.** That write is the human's
this session whatever the switch says, and the house shape for a human-only write
is a use-case refusal and no CLI surface at all.
```

```
retroloop attribute <action> [name]

The attribute vocabulary — the queryable primitive: a named value a record
carries, with one of four fixed types (the owner: *"they can say it's always
going to be a number. Then it will be easier for them to query"*).

Actions:
  list                  Every attribute, retired ones included, in minting order
  create <name> --type  Create one with its type
  rename <name> --to    Rename one; the type is untouched
  retire <name>         Stop offering it
  unretire <name>       Offer it again, still of the type it was created with

Options:
  --type <t>            create: number | text | url | date            [required]
  --to <name>           rename: the new name                          [required]
  --json

Gated by the same switch, addressed by name the same way, retired rather than
deleted, and un-retired the same way — `label` above carries the whole of that.

**There is no retype**, and `--type` on anything but a create is a usage error
that says why: every value already stored was accepted under the type the
definition carries, and this store never rewrites what somebody wrote. Retiring
the attribute and creating the one you meant is the whole alternative.

**And no way here to set a value on a record**, for the same reason there is no
way to apply a label.
```

```
retroloop comment <action>

Thread comments, anchored to a record section or to the review itself. The CLI
writes as the AI; human comments are UI-only and immutable.

Actions:
  add                   Reply in a thread as the AI
  list                  List threads

Options:
  --retro <id>                                                        [required]
  --record <rid>        add: the record whose section thread to write in; list: filter
  --section <name>      add: title | problem | human_words | root_cause | workaround | direction | footprint | solutions | defaults
  --thread <id>         add: reply in an existing thread, review-level or record-level
  --review              add: open a new review-level thread, anchored to no record
  --text "<body>"       add: inline (or --file)
  --unanswered          list: threads where the last message is human
  --json
```

**`add` names one of three targets, and never infers one** (retro 4
`r-cli-review-thread-reply`). It took `--record --section` alone for a session,
while the store had taken all three since lane B — so the owner's first
review-level asks had no sanctioned answer and the reply detoured through chat,
the exact smuggling review-level threads were built to end. `--thread <id>` is
the one that answers where he asked: a review-level thread carries no `rid` and
no `section`, so its id is the only handle on it, and `comment list` is where the
id comes from. `--review` opens a new one. Naming none is exit 2 rather than a
review-level default: a bare `comment add` is a forgotten `--record` far more
often than a deliberate ask.

**`retroloop request` is gone** (retro 4 `r-remove-requests`). `request list` and
`request respond` read and answered a top-level ask channel that duplicated the
review's comment threads; the owner removed the experience on first contact, and
`comment list --unanswered` / `comment add` are the whole of the AI's side now.
`revision get` dropped its `requests` key with them — no store has ever carried
a request row, so the key could only ever have been empty. The table stays,
unread, the way the `holds` table does.

```
retroloop export

Write a JSON export (schema: `retroloop schema export`), or Markdown / TOON rendered
from it. JSON is the public contract for user-written import scripts — there are
no built-in tracker integrations. (TOON: token-oriented format for LLM
consumption — exact spec OPEN, see JOURNAL.)

Options:
  --retro <id>          Export one retrospective (or --session | --project)
  --session <id|uuid>   The session's latest finished retrospective (--all for every one)
  --project <name>      Every finished retrospective of a project
                        [DEFERRED with --session --all: multi-retrospective output
                        cannot conform to export.v1's single-retrospective envelope;
                        needs an owner decision on a collection format — see
                        brief-001 D6 addendum. Not implemented in item 4.]
  --since <date>        project: finished after this date
  --state <s>           Only records in this state (e.g. approved)
  --format <f>          json | md | toon                              [default: json]
  --out <file>          [default: stdout]
  --json                Print a receipt { path, records, bytes } instead of the export
```

```
retroloop schema <name>

Print the JSON schema the AI authors against.

Names:
  revision              Input for `retroloop revision create --file`
  export                Output of `retroloop export --format json`

Options:
  --version <v>         Schema version                               [default: current]
```

## Priority note

`backup`, `restore`, `update`, `service` polish, `open --browser`, md/toon export are **low priority** — implemented only after the core loop (session → note → revision → review → wait → export json) works well (owner's tiering).
