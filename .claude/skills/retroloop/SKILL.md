---
name: retroloop
description: File a retrospective for this working session through Retroloop — capture frictions as they happen, draft records, hand them to the human for review, and export the outcome. Use when the human types /retroloop, asks to "do a retro" or "file a retro", or at the end of a working session when there are frictions worth recording.
---

# Retroloop — the session retrospective loop

Retroloop is a local-first retrospective tool. **You draft; the human decides.** You
never approve a record, decline one, send one back for a rewrite, write the
reviewer's note, or press his **Finish review** button — those are his, and the
CLI has no command for any of them. You write plenty here — drafts, notes,
replies in his threads — but on **the review's outcome** you have exactly one
act: **closing it to export** once he is done and nothing is left to address. It
decides nothing, it refuses if he has not finished, and step 5 is where it lives.

Everything you need to run the loop is in this file: the commands, every field
you author, every vocabulary you choose from, and the shape of every answer you
get back. You should not have to read Retroloop's source to file a retrospective, and
you should never guess at a field name. When something you need is genuinely not
here, ask the human rather than inventing it.

**A note on the citations below:** a rule citation of the form `retroloop N r-...`
is the authoring repository's own provenance — the retrospective record the rule
came from — and it resolves only there; every rule is stated in full beside its
citation, so anywhere else the reference is safe to ignore.

## 0 · Running the CLI

Every command is `retroloop <something> --json`: one JSON object on stdout, errors as
`{"error":{"code","message"}}` on stderr. Find out once, before anything else,
which of the three worlds you are in:

**1 · `retroloop` is on your PATH.** Run the commands exactly as this file writes
them.

```
retroloop --version
```

That prints a bare version string (`0.0.0`) on stdout — it is the one command
that ignores `--json`. Any output at exit 0 means the binary is there.

**2 · It is not on PATH, but you are inside the Retroloop repository.** Find the root
by walking **every** ancestor of your working directory, not just the nearest
one: at each level, read a `package.json` if there is one, and stop at the first
whose `name` is `retroloop` **and** whose `scripts` contain `retroloop`. That directory
is the repository root. Keep walking past any other `package.json` you meet —
Retroloop is a workspace, so a subdirectory like `apps/cli` has its own, named
`@retro/cli`, and stopping there would tell you world 3 while you are standing
inside world 2. Only a walk that reaches the filesystem root without a match
means you are not in the repository.

Every command in this file then runs **from that root** as
`bun run --silent retroloop <the same arguments>`. Put the `cd` in the same command,
every time — most harnesses reset the working directory between calls, so a
`cd` you did last turn is not still in effect:

```
cd /path/to/the/retroloop-app/repo && bun run --silent retroloop up --json
```

And in this world, **give `--file` and `--out` absolute paths**. A relative one
resolves against the repository root you just moved into, not against wherever
you wrote the file, which is how a draft goes missing between writing it and
submitting it.

`--silent` matters: without it bun echoes the command onto **stderr**, which is
where the error JSON lives. This form is the only exception to "every command is
one `retroloop …` call" — the arguments after the script name are identical. Run it
from the root you found and nowhere else: `bun run` inside a workspace package
answers `Script not found "retroloop"`, which is the loud failure you want rather
than a silent wrong binary.

**If `bun` itself is missing**, the checkout cannot help you — the CLI is run by
bun and there is no other way in. Treat it as world 3, but say the true thing
rather than the world-3 script: *"The Retroloop repository is right here at
`<root>`, but `bun` is not installed, and the CLI only runs under bun. Install
bun and I can file this retrospective; meanwhile here is what I would have
recorded: …"* Naming the one missing piece turns a dead end into a one-line fix
for them.

**3 · Neither.** Then Retroloop is not usable here and there is nothing more to
find: **stop and tell the human**, in these terms — *"I can file this
retrospective through Retroloop, but the `retroloop` command is not installed and this is
not the Retroloop repository. Install it, or tell me where the Retroloop checkout is, and
I will file it. Meanwhile here is what I would have recorded: …"* — then give
them the frictions in plain text so the session's findings are not lost. Do not
install anything and do not invent a place to write the retrospective. The two
checks above are the whole search: once the PATH lookup has failed and the walk
has reached the filesystem root, **stop searching** — going hunting for a
checkout elsewhere on the machine finds strangers' repositories, not yours.

Two things not to reach for in any world: `bunx retroloop` downloads and runs an
unrelated package of that name when the workspace has not been installed, and
there is no globally installed `retroloop` on a machine that only has a checkout.

## What you may assume

- The commands, flags and shapes written down in this file.
- `retroloop --help`, and each command's own `--help`, which are generated from the
  shipped parser and so can never be out of date. When this file and `--help`
  disagree, `--help` is right and this file has a bug worth reporting.
- Nothing else. Do not read the database, do not reach for a path inside Retroloop's
  data directory, do not talk to the server over HTTP. `retroloop up` is the only
  assumption you may make about a server.

## Exit codes

**These are all the codes Retroloop itself returns.** A code outside this list did
not come from Retroloop: either your shell never ran it (`127` is "command not
found", which means you are in the wrong world — go back to §0) or something
killed the process. Neither is a condition to improvise around. A code that *is*
on this list but makes no sense where you got it is a bug in Retroloop: report the
code and the error document to the human and stop.

`0` ok · `1` unclassified — the bug case just described · `2` you sent something
wrong (bad flags, or a revision file that failed validation) · `3` not found ·
`4` conflict (a stale `--expect-revision`, a `revision create` while his review
of the latest revision is unfinished, a comment or an export on a finished
retrospective, or a `review close` that is not allowed yet) · `5` forbidden ·
`6` pending migrations, which apply themselves and so should never reach you ·
`7` server problem, **including `review wait --timeout` elapsing**.

**There is exactly one way to reach `5`, and it is not a mistake you made.**
It is the actor rule — "only the human may do this" — and the CLI acts as the AI
on every command, with no flag to say otherwise; the things a human alone may do
(decide a record, finish a review, write a human note, annotate one, put a label
on a record, set an attribute value) have no command here to reach them from.

The one exception is the **label and attribute vocabulary**. `label create`,
`label rename`, `label retire`, `label unretire` and their four `attribute`
twins are yours to run, and they are gated by a switch on the human's settings page that starts
**off**. With it off they exit `5` and the message names the setting:

> creating the label "migrated" is refused: the AI may not write label or
> attribute definitions while the "ai_config_write" setting is off. A human turns
> it on from the settings page.

That is not a flag you got wrong and not something to retry or route around.
**Say so and carry on** — "I would add a `migrated` label, but AI config writes
are switched off; turn them on in Settings if you want me to" — and go on with
the loop, which does not depend on it. A `5` from anything else means Retroloop is
wrong about who you are: report it like a `1` and stop.

On `2`, re-read this file before retrying — it means the mistake was yours, and
the `message` says which. On `4`, re-read the state (`review status`)
before deciding what to do. On `7` from a wait, nothing has gone wrong and
nothing has been decided: see step 3.

**Exit 7 from anything other than a wait can only come from `retroloop up`**, because
`up` is the only command in this file that needs a server. Every other one —
`session create`, `note`, `revision`, `review`, `record`, `comment`, `export` —
reads and writes the database in its own process and works perfectly well with
the server down; even `review wait` polls locally, which is why waiting survives
a server that is not running. So an exit 7 from `up` means the human cannot open
the review page, and nothing more: **tell them the server would not start and
carry on with the loop**, which is unaffected. Only the URL you print is worth
less.

**On `3`, you addressed something that is not there, and the message says what**
(`retrospective 999 not found`, `session … not found`, `thread 404 not found`).
Almost always it is a number: a `retro` position number passed to `--retro`, a
`retroId` from another session, or a `threadId` you did not read out of
`comment list`. Re-derive the id — the recovery lookup below turns a session into
its `retroId` — rather than trying neighbouring numbers.

The `error.code` beside the message is a stable string — `USAGE`, `VALIDATION`
(both exit 2), `NOT_FOUND` (3), `CONFLICT` and `FINISH_GATE` (both 4),
`FORBIDDEN_ACTOR` (5), `TIMEOUT` and `SERVER` (both 7). Branch on the exit code
or on that, never on the message text. `FINISH_GATE` is the one worth telling
apart by name: it means records are undecided, and step 4 says what to do.

## Labels and attributes

Two vocabularies a human keeps on the settings page, and the only part of Retroloop's
configuration you can touch. They exist because the owner asked for both and
ruled each of them pure:

> *"Usually labels are just labels. A user can create their own conventions if we
> support labels as well as attributes — they can have a convention that whenever
> we add the migrated label, we should also have an attribute that requires a
> GitHub issue id, or something like that. However, to keep it flexible we will
> not hardcode any labels or attributes."*

- **A label is a name a record wears, or does not.** Nothing travels with it — no
  note, no reference, no payload of any kind.
- **An attribute is a named value a record carries**, with one of four fixed
  types: `number`, `text`, `url`, `date`. Validation is deliberately light — a
  number parses, a URL starts `http://` or `https://`, a date is `YYYY-MM-DD`.
- **Nothing is shipped.** A store starts with zero of each. `migrated` is the
  owner's example, not a value Retroloop knows about, so do not assume it exists.
- **Pairing them is the user's convention and never a rule.** Do not refuse to do
  something because a labelled record carries no value; nothing in Retroloop checks
  that, and neither should you.

```bash
retroloop label list --json                              # every label, retired ones included
retroloop label create "migrated" --json
retroloop label rename "migratd" --to "migrated" --json   # every record wearing it reads the new name
retroloop label retire "wontfix" --json                   # stops being offered; never deleted
retroloop label unretire "wontfix" --json                 # offers it again; the same row, unchanged

retroloop attribute list --json
retroloop attribute create "external issue id" --type url --json
retroloop attribute rename "ticket" --to "external ticket ID" --json
retroloop attribute retire "story points" --json
retroloop attribute unretire "story points" --json        # still of the type it was created with
```

Four things to know before you run any of them:

1. **The writes are gated.** All eight exit `5` while the human has AI config
   writes switched off — see §Exit codes for what to do, which is to say so and
   move on rather than retry.
2. **Definitions are addressed by name**, case-insensitively, so `label retire
   Migrated` finds the one created as `migrated`. The `--json` answers carry an
   `id` too; you never need it.
3. **Retiring is not deleting, and it is reversible.** The row stays, the name
   stays taken, and every record already wearing the label goes on wearing it —
   what stops is the offering, and `unretire` starts it again on the same row.
   Still retire only what the human asked you to: reversible is not permission,
   and un-retiring something he retired on purpose is the same mistake in the
   other direction.
4. **You cannot put a label on a record, or set a value.** Those writes are the
   human's this session and there is no command for them, by design. If a record
   should be labelled, say so; do not look for the flag.

## The names and numbers you will be handed

Four of them, and two pairs of them look alike. Getting one wrong is the most
common way to spend a round on nothing.

| what | looks like | where it comes from | what takes it |
|---|---|---|---|
| the session id | `71e3bff4-fc2e-4f09-85fe-170f90a451fe` — a UUID by convention, any stable non-empty string in fact | you, at registration (the procedure below) | `session create --claude-session`, then `--session` |
| `sessionId` | `4` | returned by `session create` | `--session`, interchangeably with the string above |
| `retroId` | `34` | returned by `revision create` | **`--retro`** — always this one, never the number below |
| `retro` | `1` | returned by `revision create` beside `retroId` | nothing. It is the retrospective's position within its session, for reading — "Retro #1" on the human's screen |

- **`--session` accepts the UUID or the integer id**, and means the same thing
  either way. A string of digits is read as the id; anything else as the UUID.
  Every command that addresses a session or a retrospective takes it: `note add`,
  `note list` (where it is the only way and is required), and `revision create`;
  and as an alternative to `--retro` on `revision get`, `review status`,
  `review wait`, `review close`, `record list`, `comment list`, `comment add` and
  `export`, where it means "that session's retrospective". `session create` is
  the one exception — it takes `--claude-session`, because it is the call that
  mints the `sessionId` the others can use.
- **`--retro` accepts only the `retroId`.** Passing the little `retro` number
  gets you exit 3, or worse, someone else's retrospective.
- In the commands below, **`<session-id>` is the string you register with** and
  **`<session>` is either form** — that same string, or the integer `sessionId`
  it returned.

**Getting the session id — the procedure, in order.** It gates every command, so
settle it before you file anything:

1. **Use the id of the session you are running in, if your harness has already
   given it to you.** The test is simple and has one answer: **it is in your
   context or it is not.** Agent harnesses that have one usually state it at
   session start. If it is there, use it and stop here. **Do not go looking for
   it on disk** — a directory of transcript files cannot tell you which one is
   the conversation you are having, and a confident wrong id is worse than a
   minted one.
2. **If you do not, mint one and keep it.** `--claude-session` is checked for
   presence only — **not** for UUID syntax — precisely so a caller with a
   different stable identifier is not turned away. Any non-empty string is legal.
   Mint something that identifies *this* session and could not collide
   (`retro-2026-08-25-a3f9` rather than `session`), write it down in your working
   notes, and pass the identical string every time. **Never mint one made only of
   digits:** `--session` reads an all-digits value as the integer `sessionId`, so
   `20260825` would be looked up as session number 20,260,825 and found missing —
   a dead end with a confusing error. Keep a letter or a hyphen in it.
3. **If you cannot do even that** — you have no way to keep a string stable
   across your own turns — **ask the human for one**: *"I need a stable id for
   this session to file the retrospective under. Give me any string, or paste
   your session id."*

The one rule under all three: **the string must never change mid-session.**
`session create` is idempotent by it, so passing the same string again is free
and returns the same `sessionId`; passing a different one silently registers a
*second* session, and the notes you already filed stay on the first.

**If you lose a string you minted, it is gone, and you say so.** There is no
command that lists sessions — nothing enumerates what has been registered — and
every lookup needs the id it is looking for. So:

- **If you still have the `sessionId`**, you have lost nothing: it is the second
  form of `--session` and every command takes one or the other.
- **If all you have is a `retroId`, you have half.** It reads the round, answers
  threads, closes the review and takes the export — everything that accepts
  `--retro`. It cannot **file a revision** or **add or read a note**: those three
  are session-addressed only, and **nothing turns a `retroId` back into a
  session**. So a `retroId` alone can finish a review already under way, but
  cannot answer it with a new draft. Get the session back before you need it: ask
  the human, whose session URL ends in the number (`…/sessions/12` → `12`), or
  look for it in your own earlier output — `session create` and every
  `note` call printed it as `sessionId`.
- **Otherwise, ask the human**, who may have it in the conversation: *"I filed
  notes earlier under a session id I no longer have. Do you have it in the
  scrollback?"*
- **If nobody has it, the notes you filed under it are stranded** — reachable in
  the web UI, not by you. Register a new id, say plainly that earlier notes exist
  under an id you lost and are not in this draft, and draft from the conversation
  instead. Do not register a fresh id quietly and let the retrospective look
  complete when it is not.

**Recovering a `retroId` you have lost** — a resumed session, a compacted
context, a retrospective started before you were spawned. Ask the session for it:

```
retroloop review status --session <session> --json
→ {"retroId": 34, "state": "reviewing", "finished": false, "revision": 1,
   "counts": {"pending": 2, "approved": 3, "declined": 0, "revise": 1, "hold": 0, "total": 6}}
```

A session resolves to its one unfinished retrospective, or — when they are all
finished — to the most recent one. Every read command takes `--session` the same
way, so you can always trade a session for its retrospective. The trade does not
run the other way: see the `retroId` bullet above.

**Exit 3 here means one of two different things, and they are easy to tell
apart.** If the session id is wrong, the message names the session
(`session … not found`) — that is a lost id, and the bullets above are the
recovery. If the session exists but no revision has ever been filed under it, the
message names the retrospective — **nothing has been filed yet**, which is not a
problem to recover from at all: go to step 3 and file revision 1. Do not re-run
this lookup expecting a different answer.

**And the review URL, if you have lost that too:** it is the server's URL with
`/retros/<retroId>` on the end — `retroloop up` prints the first part. It is how the
CLI builds the URL it hands you at `revision create`, except that that one also
pins the revision it just filed: `…/retros/34?rev=1`. Either opens the review.
This is the one path you may construct; everything else about Retroloop's storage
stays closed.

## The files you write

The rule against guessing paths is about **Retroloop's own storage**: its database,
its data directory, its internals. It says nothing about the files you hand the
CLI, and those are yours to name:

- **`revision create --file <path>`** — the draft you author. Write it wherever
  you can write (your scratch directory is the obvious place), name it something
  you can find again, e.g. `revision-2.json`, and keep it after submitting: the
  next revision starts as a copy of the last. Losing it is survivable — step 4
  says how to rebuild it from what you already submitted.
- **`export --out <path>`** — where the export lands. Pick the path, then tell
  the human exactly where it went. Leave `--out` off and the document goes to
  stdout instead.

Anything read *in* — the draft, a long note, a long comment — takes `--file -` to
read stdin instead of a path. `--out` writes a file and has no such form.

## 1 · At the start of a session

Register the session once. It is idempotent by the Claude session UUID, so
running it again is free and returns the same id.

```
retroloop session create --claude-session <session-id> --cwd <dir> --supervised --json
→ {"sessionId": 12, "url": "http://localhost:24100/sessions/12"}
```

`--cwd` is required and is the working directory of the session.
`--supervised` records that a human was attending this session — leave it off for
an unattended one. It changes nothing in the loop: nothing branches on it, and it
travels into the export as a fact about the session. `--project <name>` and
`--branch <name>` are optional annotations; nothing groups or filters by them.

**Session identity is written once.** A second `session create` with the same id
returns the first registration unchanged — it does not update the `cwd`, the
project or the branch. So getting them right on the first call is the only chance
you get; being wrong about them is not worth a second session id.

## 2 · During the session

The moment something costs the human or you time — a wrong turn, a confusing
instruction, a tool that misled you — file it. Do not save them up; a note
written an hour later has lost the detail that made it worth writing.

```
retroloop note add --session <session> --text "<what happened>" --kind ai-cost --json
→ {"noteId": 13, "sessionId": 12, "kind": "ai-cost", "at": "2026-08-25T09:12:44.301Z"}
```

`--kind` says who paid, and it is one of exactly two values: `human-cost` (the
default) when it cost the human time or patience, `ai-cost` when it cost you
tokens or turns. There is no third, and no "both" — pick the side that paid more.
Use `--file <path>` or `--file -` for a note too long to inline.

Notes are append-only. There is no edit and no delete — a correction is another
note.

### Coming in at the end, with nothing filed

The common case, and the one steps 1 and 2 read as already missed: the human asks
for a retrospective at the end of a session where you filed no notes as you went.
**This is a supported entry, not a failure state.** Do this:

1. **Register the session now** (step 1). Registration is not backdated and does
   not claim to be; `startedAt` is when you registered, and nothing downstream
   reads it as the moment work began.
2. **Draft straight from the conversation in front of you** — go to step 3 and
   write the records from what you can still see. Do **not** replay the session
   as a burst of `note add` calls first: notes are timestamped when written, so a
   backfilled note claims a time it did not happen at, and it buys you nothing
   the draft does not already have. Step 3's `note list --with-human` still
   earns its place, though: he may have filed notes even though you did not.
3. **Say so, once, to the human**: *"I did not keep notes during this session, so
   these records are reconstructed from the conversation."* That is an honest
   caveat about the evidence, and he reads the records differently knowing it.

The rule in step 2 — file it the moment it happens — is about the *next* session,
where the detail is still there to lose. It does not forbid drafting from memory
when memory is all there is; it explains why drafting from memory is worse.

**A different case, and it is not this one: you were asked to file a retro for
work you did not do.** Then there is no conversation to draft from — you cannot
read a session you were not in, and its notes are the human's to show you, not
yours to go looking for. Say so and ask: *"I wasn't in that session, so I have
nothing to draft from. Tell me what happened, or point me at the session id if
notes were filed under it and I will read them back."* With an id you are back in
step 3 with `note list --with-human`; without one, what he tells you in chat is
the material, and the records should say that is where they came from.

## 3 · When the human types `/retroloop`

**Make sure the server is up**, so the URL you print is one they can open:

```
retroloop up --json
→ {"url": "http://localhost:24100", "port": 24100, "pid": 4711, "started": false}
```

`started` says whether **this call** started the server: `false` means it was
already running, which is just as good. Either way the `url` is live, and it is
the one to hand the human. (If `up` returns a `lanUrl`, the human bound the
server to the network himself with `--bind`; hand him `url` and leave `lanUrl`
alone unless he asks.)

**Read the session back — including the human's side of it.** This is the one
moment you are allowed to see the human's notes and their annotations on yours:

```
retroloop note list --session <session> --with-human --json
→ {"sessionId": 12, "notes": [{"noteId": 13, "author": "human", "kind": null,
    "text": "…", "at": "…", "annotation": {"text": "…", "at": "…"}}]}
```

Pass `--with-human` **only here, at drafting time**. Their notes are not a feed
to watch while you work; reading them mid-session is exactly what the rule
against it prevents. Without the flag you get your own notes back and nothing
else. An `annotation` is the human's one-shot remark on one of your notes —
there is no reply to it, and it is often the sharpest thing in the list.

**This is a step-3 read, once per retrospective, not once per round.** Later
rounds do not come back here: after revision 1 every ask of his arrives as a
comment on the review, which is what step 4 reads. Re-running `note list
--with-human` between rounds tells you nothing new and is the thing the never-do
list forbids outside this step.

Two things in that shape: `author` is `"human"` or `"ai"`, the only two actors
there are; and `kind` is `null` on every human note, because who-paid is a
judgment you make about your own notes and he was never asked for one. `null`
there is not missing data.

**Run this even when you filed no notes yourself.** It is not a wasted call: the
human may have written notes or annotated yours while you were working, and this
is the only moment you are allowed to look. An empty list is an answer, and it
costs one call to get it.

### Before you write: do the deep dive

**Every record is a piece of research before it is a piece of writing.** The
human's words are the ask (*"the AI should do deep-dive and propose solutions (up
to 3)"*), and they are an ask about the work you do before drafting, not about
how much you type. For each friction, go and look: read the code, the docs and
the instruction surfaces the friction actually ran through, find where the cost
came from, and only then decide what could be done about it. A record whose root
cause is "the AI did not know" and whose solutions are "tell it" is a record
nobody researched.

**The deep dive includes a mandatory class check against the prior exports.**
The complete history of every past friction sits machine-readable in
`~/.ai-team/retro/exports/retro-*.json`, and it is an instruction surface the
loop itself produced — so before drafting, search it for the CLASS, not just
the instance (titles, slugs and problem text are all searchable). A record of
a recurring class must carry three things: **its priors by name**, **why each
prior fix did not hold**, and **a solution scoped to the class rather than
the instance**. The loop's own history is the evidence (retro-12
`r-instance-patch-loop`): the finish channel broke three times across retros
7, 9 and 12 while each fix repaired only the hop that had just failed, and
rules-that-do-not-bind accumulated six instances across retros 8–12 after
retroloop 8's root had already named the mechanism — new instances kept getting
new sentences because nothing in the loop read its own output at drafting
time.

**Then propose one to three ways to solve it, and say which one you recommend.**
Not three for the sake of three — *"In some places only 1-2 might make sense when
it is a quick fix"*. Propose more than one when the fix has a real choice in it:
a cheap patch and a proper repair, a local workaround and a contract change. Each
solution is a whole answer on its own — its own bullets, its own footprint, its
own level — because the human picks exactly one and that is the one the solving
side will build.

The questions that decide how many, and which one you stand behind:

- **Is there more than one honest answer?** If the only sane fix is one line in
  one file, one solution is the truthful draft and a second one invented to fill
  the slot wastes his reading.
- **More than three?** Three is the cap and there is no flag that lifts it. Two
  of your candidates are almost always the same solution at different sizes —
  merge them and say the size difference in the bullets. If they genuinely are
  four distinct ceilings, drop the one you would argue against hardest and say in
  the recommended solution's bullets that you considered it and why it lost.
- **Do the answers sit at different levels?** The most useful set is a ladder:
  guidance at level 1, a tune at level 2, a new surface at level 3. He is
  choosing a **ceiling**, and a ladder is what makes that choice mean something.
- **Would you defend the one you marked?** Exactly one solution carries
  `"recommended": true`, and it is your judgment on the record. Marking the
  expensive one because it is thorough, or the cheap one because it is safe,
  without saying why in its bullets, is a recommendation he cannot check.

### The revision file

A revision is one JSON document: an optional `title` and an array of `records`.
Every friction worth recording is one record.

```json
{
  "title": "The lock file that outlived its process",
  "records": [ … ]
}
```

`title` is optional, at most 80 characters, and is the name the human reads on a
list of retros — so write what this retro was *about* in plain language, never
"Retro 3" and never a bare number. Every revision carries its own and the newest
one wins, so when a later draft is about something else, retitle it.

**The title is a one-liner of the work, never a summary of the records** (his
rule, retro 5 `r-retro-title-convention`). Write it from the reader's vantage,
not yours: the title is read at the moment someone picks a retro out of a list,
and at that moment they have not read the records — what they know is what was
done. So name the work this retro covers, which is everything done in the
session since the previous retro, or since the session started when this is the
first one. A second retro on the same session is titled by its own segment
alone; a whole-session title on it would misname both.

- **Right:** `Shipped the whole retro-4 fix queue and rebuilt the review experience`
- **Wrong:** `Four cold reads, a committed lane report, and two toothless assertions`
  — that is the contents, which is the one thing the reader cannot yet know.

**Every field of a record, and nothing else.** The document is strict about keys
it does not know: any key outside these lists is a validation error (exit 2), and
so is a missing *required* one. **Exactly three keys are optional in the whole
document** — `title` at the top level, `context` inside a `humanWords` entry, and
`involvement` inside `defaults` (it defaults to `undecided`). Everything else
below must be present.

**Three keys that used to be here are now exit 2**: `agreedDirection` and
`footprint` on the record, and `solutionLevel` inside `defaults`. A record no
longer has one direction, one tree of files and one ceiling — it has `solutions`,
and each solution carries all three. Records filed before that change keep those
fields forever and you will read them back on old revisions; you may not write
any of them again. That is the whole list: nothing else moved.

| field | type | notes |
|---|---|---|
| `rid` | `"r-lowercase-hyphenated-words"` | the stable slug; see identity below |
| `num` | positive integer | the display number; see identity below |
| `title` | string | one line, what the friction was; no length limit (the 80-character cap is the *revision's* title, not this one) |
| `type` | `"issue"` \| `"feature"` | `issue` = something cost you or him time that should not have; `feature` = nothing broke and the thing is missing, or a practice worth keeping. When both fit, ask what the record is *for*: fixing a cost or adding a capability |
| `problem` | string | bold-lead bullets (form 1 below) |
| `humanWords` | array of `{verbatim, cleaned, context?}` | may be `[]` when the human said nothing quotable |
| `rootCause` | `{whatHappened: string, whys: string[], root: string}` | `whys` is 1–5 entries; see form 2 below |
| `workaround` | string | free text, or the literal `"none"` — never absent |
| `solutions` | array of `{bullets, footprint, level, recommended}` | one to three, lowest level first, exactly one recommended; see below |
| `requester` | `"human"` \| `"ai"` | who raised it |
| `impacts` | `"human"` \| `"ai"` | whom it primarily costs |
| `defaults` | `{severity, involvement}` | your two proposals; see below |

- **`humanWords[]` is the quote twin.** `verbatim` is what they actually said,
  garbles included; `cleaned` is the same words with dictation noise fixed and
  nothing else changed — not a paraphrase, not a summary. Both halves are
  required on every entry. `context` is optional and says where they said it
  ("while watching the deploy log"). One entry per quotable instance.
- **Attribute the entries inside a solution's `bullets`.** Nothing is agreed when
  you write revision 1, and the human needs to see whose idea he is reading:
  mark an entry `(AI-suggested)`, `(human-suggested)` or `(agreed)`, and only
  write `(agreed)` for what he has actually said yes to. Attribute the entries
  that came from somebody in particular; a solution you worked out yourself does
  not need `(AI-suggested)` on every line.
- **Every string in the document is validated for presence.** `title`,
  `problem`, `workaround`, both halves of every quote, `whatHappened`, each `why`,
  `root`, and each solution's `bullets` and `footprint`: whitespace alone is exit
  2 as surely as an omitted key — `revision: records.0.problem — problem must not
  be empty`. **There is no string in this document that may be empty** —
  `context` inside a quote is simply omitted when there is nothing to say, which
  is not the same as sending `""`. When there is no workaround and no file to
  touch, the literal string `"none"` is the answer.
- **`requester` and `impacts` take `"human"` or `"ai"`, and nothing else** —
  those two strings are also the only two actors in the whole system: every
  comment, note and decision you read back is authored by `"ai"` (you) or
  `"human"` (him).
- **A `records` array may legally be empty, and you should never send one.** The
  schema accepts `{"records": []}` at exit 0 and it files a revision that
  replaces the round with nothing to review. If you have nothing new to say,
  file no revision at all.

### Identity: `rid` and `num`

Minted once per retrospective, at the record's first appearance, and never moved.
The rules are enforced across every revision, so breaking one costs you a round:

- **`rid` is a stable slug**, `r-` followed by lowercase words joined by single
  hyphens (`r-stale-lock`, `r-cli-review-thread-reply`). **Digits are allowed**
  inside a word (`r-http2-timeout`, `r-retro-4-bug`); capitals, underscores,
  dots, a trailing hyphen and a doubled hyphen are not, and a rid that breaks the
  pattern is exit 2 before anything else is looked at. It is how the human's
  verdicts,
  comments and your later revisions all find the same record. Once used in a
  retrospective it belongs to that record forever — **never reuse it for
  something else, and never rename it to fix a typo**: a renamed `rid` is a new
  record, and the verdict on the old one stays behind on a record that has
  vanished.
- **`num` is the display number**, assigned once and never renumbered: a record
  that keeps its `rid` keeps its `num` in every later revision, and a `num` used
  once is never handed to another record.
- **Density is judged over every number the retrospective has ever handed out**,
  not over the file you are submitting. The union of this file and every earlier
  revision must be `1..M` with no gap. Two consequences, and they are not in
  conflict:
  - **A first revision numbered `1, 2, 4` is rejected** — nothing has ever
    numbered 3, so the union has a hole:
    `revision: record numbers must be dense from 1; got 1, 2, 4`.
  - **A later revision file containing only `2` is fine** when record 1 exists in
    an earlier revision. Dropping a record from a draft is allowed; its number
    stays spoken for forever, and the union stays dense.
- **A record you add in a later revision takes the next number after the highest
  ever used** — not the next gap, and not one more than this file's largest.
  There is no command that prints "the highest number ever"; walk the revisions
  with `retroloop record list --retro <retroId> --revision <n> --json` for `n` from 1
  to the latest and take the biggest `num` you see. Numbers only ever go up, so a record dropped in revision
  2 still holds its number in revision 5.
- **The CLI tells you when you get it wrong, and it names the right answer.**
  `r-two is record 2 in this retrospective; records are never renumbered` and
  `num 2 already belongs to r-two; numbers are never reused` are both exit 2, and
  both are cheaper to read than to guess around.
- Within one revision, two records may not share a `rid` or a `num`.
- **All of this is scoped to one retrospective, not to the session.** A second
  retrospective on the same session starts from an empty slate: numbering begins
  at 1 again, and a `rid` used in the last one may be used again here for a
  different record. When you go looking for the highest number ever used, look
  only inside the retrospective you are filing into.

**Dropping a record drops it from the outcome.** A record left out of your latest
revision is not "still approved somewhere": the gates and the export all read the
latest revision, so it is not pending, it does not block the close, and **it is
not in the export file** — its verdict included. Leave a record out only when you
mean to withdraw it, and if he approved it, say in a thread that you are
withdrawing it and why.

### The two you propose in `defaults`

Both are *proposals* — the human's values are what count, and he sets them in the
UI. Propose both anyway; declining to judge is not an option the schema offers.

```json
"defaults": { "severity": 3, "involvement": "autonomous" }
```

**There is no `solutionLevel` here, and sending one is exit 2.** A record
proposes a level per solution now, and the level it proposes *as a record* is the
level of the solution you recommended — the tool reads it from there. One field
holding a second copy of that judgment is a draft that can contradict itself.

**`severity` — 1 is highest, 5 is lowest.** Anchors, not thresholds; how often it
fires folds into the judgment, there is no separate field for recurrence. The
five below are the whole value space, on both sides: nothing else may be
proposed, nothing else may be chosen, and nothing else can come back on a read.

| value | what it means |
|---|---|
| `1` | Halts everything — the tool unusable, no progress possible; no workaround |
| `2` | Blocks a major flow — progress only through a costly manual workaround, the human dragged in each time |
| `3` | Degrades the work — real turns, tokens or time lost whenever it is hit; a workaround exists but is paid every time |
| `4` | Minor friction — an extra step, an annoyance, a cosmetic wart; cheap workaround |
| `5` | Nice-to-have — not time-critical, no workaround even needed; an improvement idea more than a problem |

**`involvement` — how much of the human the fix needs.** One of
`autonomous` (no involvement — fully autonomous), `pull-request` (human reviews
before merge), `interactive` (human works the fix live), `other`, `undecided`
(the solving side asks first). It is the one field of a record with a default:
leave it out and it is `undecided`.

**A solution whose footprint touches a permission, credential, or security
surface makes the whole record propose `interactive`** (retro 5
`r-permission-footprint-interactive`), however mechanical
the fix itself is: an agent granting itself permission rules is the guarded action
class, so the actor rule — not the difficulty — is what demands the human, and
involvement is what schedules the fix for a session he is present in. Read
**every** solution's footprint before you propose this field, not just the fix:
`involvement` is one value for the whole record, so if any solution he could pick
touches such a surface, that is the one that decides it.

**Do not *originate* `other`.** The schema accepts it, so this is judgment, not
validation: `other` means "something else, and the reviewer's note says what" —
and `reviewerNote` is *his* field, which no draft of yours can write. Proposing
it therefore proposes a value you cannot explain. When none of the three real
shapes fits, propose the closest one and **say what you actually mean in the
recommended solution's `bullets`**, which is the field for it. `other` exists for
him to pick — and once he has picked it, you carry it forward verbatim (step 4).

### The solutions you propose

One to three, and each one is a whole answer to the record:

```json
"solutions": [
  { "bullets": "…", "footprint": "…", "level": 1, "recommended": false },
  { "bullets": "…", "footprint": "…", "level": 3, "recommended": true }
]
```

| key | type | what it is |
|---|---|---|
| `bullets` | string | the proposal, as bold-lead bullets (form 1 below) |
| `footprint` | string | a tagged file tree for *this* solution, or the literal `"none"` (form 3 below) |
| `level` | `1`–`5` | this solution's ceiling; see the table below |
| `recommended` | boolean | `true` on exactly one of them |

**Four rules, all of them checked — a draft that breaks one is exit 2**, and
each refusal names itself so you can tell which one you broke:

- **One to three.** An empty array is refused and so is a fourth entry.
  `revision: records.0.solutions — a record proposes at least one solution` ·
  `revision: records.0.solutions — a record proposes at most three solutions`
- **Sorted from the lowest level to the highest — by `level`, never by which one
  you recommend.** The human's words: *"It should always be sorted from lower
  level solution to high level solution."* The order is not presentation — the
  review page titles them **Solution 1**, **Solution 2** by position and his pick
  is stored as a position, so a draft that arrives out of order would rename the
  thing he chose. The recommended one goes wherever its level puts it, which is
  often the middle. Two solutions may share a level; ties keep the order you gave.
  `revision: records.0.solutions.1.level — solutions run from the lowest level to the highest; L2 follows L4`
- **Exactly one `"recommended": true`.** None leaves him without a starting point;
  two is you declining to make the call the record is asking you for.
  `revision: records.0.solutions — exactly one solution is the recommended one; 0 are marked`
- **Every `level` is `1`–`5`.** Nothing else is accepted from you, ever. You may
  still *read back* `none`, `upstream` or `undecided` as the decided level of an
  old record — they were choosable once, human data is never rewritten, and every
  read path still admits them. Seeing one is not permission to write one.
  `revision: records.0.solutions.0.level — Invalid option: expected one of 1|2|3|4|5`

**`level` — a ceiling, not a target.** It is how much the *world outside the fix*
has to move, not how much work the fix is:

| value | what it means |
|---|---|
| `1` | Words only: guidance text; nothing executes it, nothing conforms to it |
| `2` | Tune existing: behavior change inside artifacts that already exist |
| `3` | Add surface: something new that everything existing can safely ignore |
| `4` | Change contracts: others must conform; consumers updated and old data shimmed in the same change |
| `5` | Open-ended: emergent, autonomous, or not cleanly undoable |

**Write each solution so it can be read on its own.** The human reads one at a
time — the page gives each its own tab — so a solution that says "same as above
but cheaper" is a solution he cannot judge without holding two in his head.
Repeat what it needs to repeat.

**The footprints differ, and that is the point of having one per solution.** A
level-1 solution touches a doc; a level-4 one touches the contract and its
consumers. Two solutions with an identical footprint are usually one solution
written twice — collapse them, or say in the bullets what actually differs.

### Author every record in these three forms

They are normative — the human dictated them (retro 3,
`r-record-authoring-format`) after paying a full revision round for their
absence; he reads by skimming the bold text, so a paragraph is a record he cannot
read.

Every prose field in the revision file is a plain JSON string carrying a safe
markdown subset — write the literal characters: `**bold**`, `` `code` ``,
`- ` bullets (indent a bullet under another to nest it), `1. ` numbered lines,
`> ` blockquote lines, which carry bullets and bold inside them and are how a
reply quotes him back to himself, blank lines between paragraphs, and
triple-backtick fenced blocks for preformatted excerpts (their contents are
never parsed). The review page renders exactly that subset
(retro 3, `r-prose-renders-raw`); anything else, including HTML, shows as
literal text. One exemption: a solution's `footprint` is not markdown — the page
shows it preformatted, exactly as authored, whitespace intact, which is what
makes the tree form below hold on screen.

Hard-wrapping a bullet or a paragraph across source lines is tolerated rather
than preferred: a line that opens no marker continues the block above it, so a
wrapped bullet stays one bullet, but one logical line per block is still what
reads best in the file.

1. **Prose sections are bold-lead bullets.** `problem`, `workaround`, and every
   solution's `bullets` — never paragraphs. Every bullet opens with a few **bold
   thesis words**, then the detail; nest bullets where the structure needs it.
   Skimming only the bold text must tell the whole story.
2. **The whys are a numbered list with the question in bold.** This is the
   record's `rootCause.whys` field: an array of strings, each one a markdown
   numbered-list entry. Each entry: the **why-question in bold**, then the answer
   in plain text. Never write "why 1" / "why 2" labels — the list numbering
   carries that. Someone reading only the bold text sees exactly the chain of
   questions. "Five" names the method, not a quota — stop when the chain bottoms
   out, and the schema takes between one and five.
3. **Each solution's footprint is a tagged file tree.** One string, per solution:
   the project root's real path on the first line, then a tree with every entry
   tagged `[CREATE]`, `[UPDATE]` or `[DELETE]` plus a short description of the
   exact change at that path, tags aligned in a column (the alignment is part of
   the form — he scans the tags). No code fence inside the field. A solution with
   no file to touch writes the literal `none`, like a workaround.

   **An `[UPDATE]` entry names where inside the file the change lands** — the
   section, the rule, the list it extends — **and drafting verifies that surface
   exists.** Grep for it while you write: it is the same act that would otherwise
   catch it downstream, in someone else's lane, days after the record was
   approved. **When the surface is not there yet, the entry says so** — *create
   the section* — instead of describing a place as though the file already had
   one. Whoever implements it keeps the standing recourse either way: trust the
   file over the footprint, and record the deviation.

   **A long description wraps onto continuation lines; it never runs off the side
   of the page.** The field is shown preformatted, so an over-long line
   side-scrolls the page instead of reflowing. The measure is the **whole line** —
   tree prefix, name, tag and description together — held to roughly 110
   characters, which means a deeply nested entry gets a shorter description share
   per line and a shallow one gets more. Continuation lines align under the
   description column, the tree's vertical connectors are carried through them,
   and the next entry is pushed down below. **Nothing gets shorter for it:** the
   rule decides where a line breaks, not how much it says.

   The owner's pasted example, at the measure, with one entry wrapped (the fence
   below is this document's, not the field's):

   ```
   /path/to/the/project/root/where/fix/needs/to/be/made
   ├── lib
   │   ├── button.json            [CREATE] the variant token map the styles read, one entry per variant
   │   ├── button.stories.json    [DELETE] its stories move into the component file beside it
   │   └── index.json             [UPDATE] export the token map so consumers import it from one place
   ├── package.json               [UPDATE] the build picks the token map up as an asset
   ├── src
   │   ├── button.stories.tsx     [UPDATE] a story per variant generated from the token map rather than the
   │   │                                   hand-written list that had drifted from it
   │   ├── button.tsx             [UPDATE] read the variant's tokens instead of the inline style object
   │   └── index.ts               [UPDATE] re-export the variant type the stories now import
   └── tsconfig.json              [UPDATE] the path alias the token map is imported through
   ```

**A counted claim cites the enumeration it counts** (retro 5
`r-uncounted-findings`). Whenever a record says how many of something there were
— findings, files, failures — name where the full list durably lives and check
the number against it while you draft. A record that carried "thirteen standing
findings" against the one note that enumerated eleven could not have its
fix closed item by item: the solution's bullets and its footprint both inherit
the count, and a fix session is left guessing at the difference.

**A claim about the code names the evidence it was checked against** (retro 6
`r-unverified-claims-travel`). A record that asserts something concrete about the
codebase — this file is stale, that flag is unused, this command exists — says in
the record how it was checked: the command you ran, the `file:line` you read.
Check it while you draft, not from memory, and if you cannot, write the claim as
unverified so the human reads it as one. Review reads a record for direction, not
for code truth, so an unchecked premise is not caught downstream: an approved
record once directed removing a documented `--data` flag as stale when `--data`
was live in the CLI's own source, and applying it would have written in the very
false claim the record existed to remove.

### One whole record, as a file

Everything above, in the shape the CLI takes. `\n` is how the newlines of a
markdown field are carried in JSON:

```json
{
  "title": "The lock file that outlived its process",
  "records": [
    {
      "rid": "r-stale-lock",
      "num": 1,
      "title": "Deploy blocked 40 minutes on a lock nothing held",
      "type": "issue",
      "problem": "- **The deploy hung with no output** for 40 minutes on a lock file whose owning process had been killed hours earlier.\n- **Nothing said so:** the wait has no timeout and no diagnostic, so the only symptom is silence.\n- **It has fired three times this month**, and each one costs a human noticing and intervening.",
      "humanWords": [
        {
          "verbatim": "this thing has been sitting there for ages doing nothing",
          "cleaned": "This has been sitting there for ages doing nothing.",
          "context": "while watching the deploy log"
        }
      ],
      "rootCause": {
        "whatHappened": "The deploy script took an advisory lock, the process was killed, and the next deploy waited on a lock with no owner.",
        "whys": [
          "**Why did the deploy hang?** It waited on a lock file that no live process held.",
          "**Why was the lock still there?** The holder was killed and the lock is only released on a clean exit.",
          "**Why did nothing notice?** The lock records no PID, so no reader can tell a held lock from an abandoned one.",
          "**Why is there no timeout?** The wait was written for a queue of seconds and never revisited when deploys grew."
        ],
        "root": "Locks are advisory with no liveness check, so an abandoned lock is indistinguishable from a held one."
      },
      "workaround": "- **Delete the lock file by hand** once you have confirmed no deploy is running — costs a human every time it fires.",
      "solutions": [
        {
          "bullets": "- **Say in the runbook that the lock must be cleared by hand** after a killed deploy, and how to tell it is safe.\n- **Costs nothing and fixes nothing:** the next person still pays the 40 minutes before they think to look it up.\n- **Worth having anyway** as the stopgap until one of the two below lands.",
          "footprint": "/path/to/the/project/root\n└── docs\n    └── runbook.md                [UPDATE] how to tell an abandoned lock from a held one, and how to clear it",
          "level": 1,
          "recommended": false
        },
        {
          "bullets": "- **Write the holder's PID into the lock** and treat a lock whose PID is not alive as free. (AI-suggested)\n- **Fail loudly after 60 seconds** rather than waiting forever — the silence is half the cost. (agreed)\n- **Nothing outside the deploy path changes:** the lock file gains a line, and every reader of it is in these two files.",
          "footprint": "/path/to/the/project/root\n├── scripts\n│   └── deploy.sh              [UPDATE] fail after the wait budget instead of blocking\n└── lib\n    └── lock.ts                [UPDATE] write the holder PID; treat a dead holder's lock as free",
          "level": 2,
          "recommended": true
        },
        {
          "bullets": "- **Replace the advisory lock with a lease** that expires on its own, so no abandoned lock can exist to be waited on.\n- **Every caller has to conform:** the three other scripts that take this lock renew it or lose it.\n- **The honest fix, and the expensive one** — it removes the class of failure rather than this instance of it.",
          "footprint": "/path/to/the/project/root\n├── lib\n│   ├── lease.ts               [CREATE] acquire, renew and expire; the lock file's replacement\n│   └── lock.ts                [DELETE] every caller moves to the lease\n└── scripts\n    ├── backup.sh              [UPDATE] renew the lease around the copy\n    ├── deploy.sh              [UPDATE] take a lease instead of a lock\n    └── migrate.sh             [UPDATE] renew the lease around the migration",
          "level": 4,
          "recommended": false
        }
      ],
      "requester": "human",
      "impacts": "human",
      "defaults": { "severity": 3, "involvement": "autonomous" }
    }
  ]
}
```

Three solutions here because the record has a real choice in it, and they read as
a ladder: write it down, fix this lock, or remove the possibility of an abandoned
lock at all. The middle one is recommended and its bullets say why — the failure
is contained to two files. A quick-fix record would have carried one solution and
been finished.

### Submit it

`--expect-revision` is an optimistic check and is **optional** — the create
succeeds without it. Pass it anyway, every time: it costs nothing, and it turns
"something else filed a revision while I was drafting" from a silent overwrite of
the round into exit `4`.

**It names the revision you are about to write, not the one that exists.** The
first draft of a retrospective is `--expect-revision 1`, and the answer comes back
`"revision": 1`. Read the number back off the answer rather than counting: it is
the one every later command addresses this round by. Revision
numbers start at 1 and count within one retrospective.

```
retroloop revision create --session <session> --file <path> --expect-revision <n> --json
→ {"retroId": 34, "retro": 1, "revision": 1, "url": "http://localhost:24100/retros/34?rev=1"}
```

**Keep the `retroId`.** It is how every command below addresses this review, and
`retro` beside it is not it (see "The names and numbers" above).

**Print the `url` to the human, and tell them what you are waiting for.** Not
just "it is ready" — say the sentence that makes the loop work: *"Here is the
review: <url>. Go through the records, then **press Finish review** — nothing
reaches me until you do."* That press is the only signal there is. A human who
reads the page, decides every record and closes the tab has told you nothing, and
you will sit in a wait that never returns wondering what went wrong.

**And say what is watching.** If the bridge below is certified and armed, that
sentence is enough. If it is not — a raw background wait, an unprobed harness, a
watcher you have not re-armed yet — the same message says the channel is
**interim** and names its failure mode, so a quiet hour is never mistaken for a
channel that works. This costs one clause and it is the difference between him
waiting and him waiting *in the dark*.

**Then find out when he finishes.** One command answers that, in two forms.
`--follow` subscribes to the running server's live events — the same channel
that updates every open review page, at roughly 300 ms — so the press reaches
you as it happens. Without it, the command polls the database from its own
process, which is slower and answers even when no server is running.

```
retroloop review wait --follow --retro <retroId> --timeout <seconds> --json
→ {"kind": "ReviewFinished", "retroId": 34, "revision": 1, "at": "…", "via": "stream"}
```

**Reach for `--follow` first.** It needs no setup and no server check: when
there is no server to subscribe to, or the connection cannot be made, it falls
back to polling on its own and still answers. `via` is how you know which
happened — `"stream"` for the live push, `"store"` for the fallback — and it
appears only with `--follow`. Everything else about the command is unchanged:
same event, same exit codes, same four keys without the flag.

### The bridge: how you run that wait

**This channel has failed four times, and every fix repaired only the hop that
had just broken.** Read the whole chain before choosing a rung, because the hop
that bites you next is one nobody has looked at yet:

| hop | what carries it | what it cost when it broke |
|---|---|---|
| his press → the store | the review page's mutation | — |
| the store → the wait | `review wait`, polling or `--follow` | retro 9 `r-monitor-not-realtime`: a 20s sleep between the press and the wait noticing |
| the wait → the watcher | the process you armed | retro 7 `r-finish-event-unnoticed`: nothing was armed at all |
| the watcher → YOU | **the watcher's process EXIT** | retro 12 `r-monitor-notify-gap`: the watcher saw the press, printed a line, and told nobody |
| the watcher staying alive | whatever runs you | retro 13 `r-fourth-finish-channel-failure`: two outside kills, read as a stop gesture, and the watch stood down mid-review |

**Rank the rungs by DELIVERY CERTAINTY, never by capability.** The old ladder put
a line-streaming monitor on top because streaming lines is richer than one exit,
and that is how retro 12 happened: this harness re-invokes an agent when a
background task **EXITS** and never when it prints a line, so during the entire
window the monitor existed to cover it could not emit the one signal that
travels. Task exit is the signal EVERY harness in use delivers. That makes the
one-shot the default and the monitor the exception.

**Rung 1 — one exit-on-event wait, whose EXIT is the notification.** Run exactly
one `review wait --follow --timeout <n>` as a background task and end your turn.
There is no loop: when it exits you are re-invoked, and you read the exit code.

```
scripts/watch-review.sh <retroId> [--timeout <seconds>]     # in this repository
retroloop review wait --follow --retro <retroId> --timeout 600 --json   # anywhere else
```

The script is the same command with the reading already attached — it `exec`s
the wait, so the process you are watching **is** the wait and no loop can be
written after it, and it prints the hop map, the meaning of each exit and the
exact relaunch line **before** blocking, because by the time the exit or the kill
arrives the script is gone and that output is all you will have.

- **exit 0** — he pressed Finish. The event JSON is on stdout.
- **exit 7** — the seconds elapsed and *nothing else*. Re-arm.
- **anything else** — an error. Read the message, and re-arm.

**Certify the chain before you trust it with his press, once per environment.**
An uncertified bridge has now cost four retros, and words test nothing:

```
scripts/watch-review.sh certify
```

It stands up a throwaway stage, files a retrospective, arms this exact shape,
presses Finish through the e2e stage-tool, and asserts the watcher **exited**
with the event — red leg first, so a watcher that fabricates an exit fails
rather than passes. Its third leg is the killed-watcher drill below.

**The one hop no script can assert is the last one**, because you are the thing
being told. Probe it by hand in any new environment before trusting any watcher:
run a background task that exits immediately — `sleep 1; echo probe` — and
observe whether its **exit notification** actually reaches you. If it does not,
this harness carries no watcher at all, and the handoff must say so in as many
words rather than leaving him waiting on a bridge that does not exist.

**NEVER STAND DOWN. RE-ARM ON KILL.** While a review is open the watch is never
voluntarily abandoned. A watcher killed from outside is **re-armed immediately,
on the kill notification itself** — the kill is what wakes you, so re-arming
costs one command and leaves no window. A kill is a fact about the task system;
it is never a gesture, never a request to stop, and never permission to hand the
notification burden back to the human. The watch ends at `review close`, or when
he says in words to stop watching. Nothing else ends it.

Retro 13 is what that sentence is made of: the harness killed the watch twice,
the lead read the second kill as quieting, stood the watch down and asked him to
say "done" in chat — and his press then sat in the store unread until he asked,
in anger, *"I finished the review but you didn't get a notification? What did
you fix then?"*

**Re-arming loses nothing, and that is measured rather than hoped.** The wait
does not listen from "now": it listens from **the retrospective's latest
revision as the store has it**, so a press that lands while nothing at all is
armed is already there when the next wait opens. `certify`'s third leg proves
exactly that — it arms the watcher, kills it mid-wait, presses Finish with
nothing armed, re-arms, and asserts the press comes straight back.

**If the owned bridge is not in place, SAY the bridge is interim.** Whenever you
are watching with anything less than a certified watcher — a raw background wait,
a harness whose exit notifications you have not probed, a session where the watch
has been killed and not yet re-armed — the handoff that gives him the URL says
so, and names the failure mode: *"the watch is interim: if it is killed I may not
hear your press, so ping me if it goes quiet."* Silence must never be mistakable
for a channel that works.

**Rung 2 — a looping monitor, ONLY after you have proved lines reach you.** If
your harness can run a watching script outside your turns **and hand you each
line it prints as an event**, one monitor covers every round without a relaunch.
That second half is load-bearing and is exactly the half retro 12's lead read
past. Prove it before you rely on it: run a background task that prints a line
and then keeps running, and check whether the line reached you as an event. It
is a strict optimization over rung 1 — fewer relaunches, nothing else — so it is
never worth an unproved assumption.

```sh
last=0
fails=0
while :; do
  event=$(retro review wait --follow --retro <retroId> --timeout 600 --json)
  case $? in
    0) fails=0
       revision=$(printf '%s' "$event" | jq -r .revision)
       if [ "$revision" = "$last" ]; then sleep 5; else
         echo "review finished: revision $revision"; last=$revision
       fi ;;
    7) fails=0 ;;  # the wait's own timeout — nothing pressed yet, re-enter
    *) fails=$((fails + 1))
       [ "$fails" -lt 5 ] || { echo "monitor stopping: review wait failed $fails times"; exit 1; } ;;
  esac
  [ "$(retro review status --retro <retroId> --json | jq -r .state)" = finished ] &&
    { echo "retrospective closed"; exit 0; }
done
```

`jq` there is only a JSON field reader — use whatever your shell has. Three
things have to be right and none is a poll. **Track the last revision you
emitted**, or the repeat between a finish and the next revision emits forever.
**Sleep only in that repeat branch** — nothing can be pressed in that window,
because the round is already finished and the review is waiting on your
revision. **Let a persistent failure emit its own line and exit**, so silence
never comes to mean "still reviewing". The `state` it reads is where the
retrospective stands — `open`, `reviewing`, `submitted`, `finished` — and it
turns `finished` only when you run `review close` at the very end; it is not the
`finished` field beside it, which is this round's press and goes true every
round, and exiting on that one would kill the monitor after round 1. `submitted`
is the middle of the loop rather than the end of it: he has put this round down
and you have not closed the retrospective, which is the moment to read the round,
not to stop.

**Rung 3 — a budgeted foreground wait, when your harness has neither.** Block in
the wait, spend a budget, and let the human relay the finish when the budget runs
out before he does. This rung puts the notification burden back on him, so it is
the rung you say out loud (the interim-bridge line above).

**Always pass `--timeout` when you are an agent, and set it below your own
command limit.** Without it the wait blocks until he acts, however long that is —
and the thing that ends it will not be Retroloop but whatever runs you, killing the
command from outside. That is not exit 7 and not an error document: it is your
turn ending mid-command, with no way to tell it from a crash.

The number is a **relation, not a constant**: your `--timeout` must sit
comfortably below whatever cap the harness puts on a single command, so that
Retroloop is what ends the wait. If you know your cap, take a fraction of it. **If
you do not know it, go small — 120 to 300 seconds — and re-arm**, which costs
nothing at all. A short wait re-armed five times is strictly better than one long
wait killed once. `--timeout 0` polls once and returns immediately — exit 0 with
the event if he has already finished, exit 7 if he has not.

**Exit 7 from a wait means the seconds elapsed and nothing else** — not that he
declined, not that anything is broken. Reviews take as long as they take. Never
read a timeout as agreement.

What to do with one: **re-arm.** A review can take days and your turn should not,
so if you are burning turns with nothing else to do — say six re-arms, or fifteen
minutes — **stop re-arming in the foreground and end your turn** with the watcher
armed in the background: give him the URL again, say in as many words that you
are waiting on his **Finish review** press and that nothing reaches you until he
presses it. Sitting in a re-entry loop for an hour costs tokens, produces
nothing, and looks from the outside exactly like a hung agent. Note what this is
not: it is not standing the watch down. The background watcher stays armed, and
it is re-armed on every exit and every kill until the review closes.

**Re-arming is always safe, and it is how you recover.** The wait does not listen
from "now", and it does not listen from anything you remember: it listens from
**the retrospective's latest revision as the store has it**. So a finish that
happened while you were not waiting — between `revision create` and `review
wait`, during a timeout, after a lost turn, after a kill, or in a session before
yours — is already there and comes back at once. That is why an agent who has
just recovered a `retroId` and nothing else can still trust `--timeout 0`: the
answer comes out of the store, not out of your context. That makes `review wait
--timeout 0` the one sanctioned way to ask "has he finished this round yet?":
exit 0 says he has, and hands you the event with the `revision` it belongs to. Do
not try to infer it from record counts; a fully-decided round he has not put down
is not a finished one.

## 4 · When the wait returns: read the round, then decide the next step

There is one button on that page — it reads **Finish review** — and one event
here. `ReviewFinished` means **the human is done with this round** — not that the
retrospective is over.
What happens next is yours to work out from what they actually wrote, which is
what they asked for: *"you look at what I requested and, based on it, send a new
revision — or say OK, there are no new requests."*

**The check, every time, before anything else:**

```
retroloop review status --retro <retroId> --json
→ {"retroId": 34, "state": "submitted", "finished": false, "revision": 1,
   "counts": {"pending": 0, "approved": 3, "declined": 1, "revise": 1, "hold": 0, "total": 5}}

retroloop comment list --retro <retroId> --unanswered --json

retroloop revision get --retro <retroId> --feedback-only --json
```

All three, every round. The counts say which records he ruled which way; the
threads say what is waiting on you; and the third is **the only command that
shows you a `reviewerNote` or a `finishMessage`** — his two free channels, which
no count and no flag will ever surface. The branch list below turns on all three,
so skipping the last one means deciding the round without having read part of it.

**`finishMessage` is his last word on the round**, written in the box the Finish
button opens and delivered deliberately apart from the comments — his own ask:
*"this message is going to be delivered separately from the comments."* It is
about the round rather than about any record, it is `null` when he left none, and
**nothing else surfaces it**: it is not a thread, it has no `threadId`, and it
will never appear in `comment list`. Read it before you decide anything below,
because it is the one place he speaks about the round as a whole.

**A revision lands only as the first of a retrospective or as the answer to a
finished round** (retro 9 `r-revision-sneaks-past-review`). `revision create`
returns `CONFLICT` (exit `4`) while the latest revision's review is unfinished,
so everything below files *after* his Finish press and never during his reading.
**When he asks for a change mid-review** — in chat, in a thread, however it
reaches you — filing is not the answer. Ask him to mark the record `revise` and
press **Finish review**, and file the rewrite as the next round; that is the
loop's own rhythm, and the refusal message names it so you relay the right ask
instead of retrying. This was convention before it was contract, and the
convention lost twice in one retrospective: a round replaced while he is
mid-read can rewrite records he has already decided, flipping them back to
pending and spending his review time on content that silently stopped existing
— *"we don't want the human spending time on a review while the AI sneaks in and
sends a new revision."* **The price is stated, not hidden:** a draft correction
seconds after your own filing also waits for a finish. That is what buys the
guarantee, and loosening it is his call, not a flag you reach for.

- **Any `revise` records** → he asked for a rewrite by name. File revision n+1;
  `review close` refuses while one stands.
- **Any thread still waiting on you** → answer it. Whether it *also* costs a
  revision depends on what it says, which is the next paragraph.
- **Any `reviewerNote` that asks for something** → treat it exactly like a
  thread: it is his free channel, it is not a verdict, and nothing mechanical
  will ever surface it. Read every one. A note is **not** a thread and has no
  `threadId`, so to answer one you open a thread on the record yourself:
  `retroloop comment add --retro <retroId> --record <rid> --section <the section his
  note is about> --text "…" --json`. When the note is about the record as a
  whole — priority, sequencing, "do this one first" — use `--section defaults`,
  which is where severity, involvement and his verdict live and what such a note
  is really about. A note about *which solution* goes on `--section solutions`,
  which is where the proposals are. When you genuinely cannot place it, `--section title` hangs it
  off the record's headline. The reply itself opens with the replay of his words,
  exactly like a thread reply — the format is in "The threads waiting on you".

**The section names are not the field names**, and one of them is a trap. Map
what he is talking about to the section that carries it:

| the field you author | the `--section` that carries it |
|---|---|
| `title` (and `type`) | `title` |
| `problem` (and `requester`, `impacts`) | `problem` |
| `humanWords` | `human_words` |
| `rootCause` | `root_cause` |
| `workaround` | `workaround` |
| `solutions` — all of them, including their footprints, and anything about *which* one he picked | `solutions` |
| the two proposals in `defaults`, and the verdict itself | `defaults` |
| *(read-only)* an old record's `agreedDirection` | **`direction`** — not `agreed_direction`, which is exit 2 |
| *(read-only)* an old record's `footprint` | `footprint` |

**`solutions` is one anchor for the whole block, not one per solution.** A thread
about the second proposal says "Solution 2" in its own words; there is no
`--section solutions.2`. And the last two rows are history: `direction` and
`footprint` still carry the threads filed on records from before solutions
existed, and you will read those threads back — you will not be filing new ones
there, because a record you write has no such section.
- **A `finishMessage` that asks for something** → it is a request like any
  other, and one about the round rather than one record. It is not a thread, so
  there is nothing to reply *to*: act on what it says, and tell him in chat what
  you did with it. If it changes what you file, say so there too.
- **Any `pending` records** → see "When records are pending after a finish"
  below. This is not a branch you can act on alone.
- **None of those** → there is nothing left to address, so close the review and
  take the export (step 5).

**This list is the floor, not the ceiling.** The counts and flags are what the
machinery can see; what you owe him is in what he wrote, and he said so himself:
*"you look at what I requested and, based on it, send a new revision — or say OK,
there are no new requests."* A record with no `revise` verdict whose note says
"this is the wrong root cause" is a request for another revision, and no field
will tell you that. Read the notes and threads before you decide, always.

**A question is not automatically a revision.** When his ask is answered by an
answer — he wanted to know something, and nothing in the record has to change —
answer it in the thread and file nothing. Nothing gates the close on threads: its
three conditions are his finish on this revision, no `pending` record and no
`revise` record (step 5), and an unanswered question is none of them. But the
close is **terminal** — a finished
retrospective takes no more comments — so do not answer a question and close in
the same breath. Closing over an answer he has not seen is inferring agreement
from silence.

**So: post the answer, then end your turn.** Tell him in chat what you answered
and that you are ready to close when he is happy, and stop there. Do not wait, do
not poll: he has already pressed Finish review for this round, so nothing is
coming that you could detect, and a reply from him arrives as a new message to
you — not as an event. When he comes back and says go ahead, close it (step 5).
If he replies in the thread instead, you will see it in `comment list` the next
time he brings you back to this retrospective.

**The two fields here do not say the same thing.** `state` is where the
retrospective stands: `open` before the first revision, `reviewing` while the
round is his, **`submitted`** once he has pressed Finish on the latest round, and
`finished` only after **you** close it in step 5. `finished` beside it is a
narrower fact as a boolean: it answers "has this retrospective been closed",
**not** "has the human finished this round" — it is `false` all the way through
his review, `submitted` included, and turns `true` only at your own
`review close`. So `state` is the field that tells you he has finished a round;
`review wait --timeout 0` (step 3) is still the one that tells you *when* he did
it, and it is what a monitor blocks on.

`revision` here is the number of the latest revision — the same number
`revision get` reports as `revision.n` when you read the latest. Call it `n`: the
next draft you file is `--expect-revision <n+1>`.

### When records are pending after a finish

The finish gate refuses while any record is undecided, so a round cannot *become*
finished with pending records — but it can *go back* to having them: he can undo
a verdict in the window between his Finish review and your close, and an undo is
one more append, not an edit. Then `review close` refuses with `FINISH_GATE`
(exit 4) and names them:

```
{"error":{"code":"FINISH_GATE","message":"retrospective 34 still has 1 pending record(s): r-slow-tests. Every record must be approved or declined."}}
```

That message's last sentence is older than the third verdict and reads narrower
than the rule: **`revise` decides a record too.** Any of the three gets it out of
`pending`.

**You cannot resolve this yourself** — a verdict is his, and you have no command
for one. Nor is re-reading the round going to change it.

**And `review wait` is spent here: do not use it.** It listens from the revision
you last submitted, and his finish for that revision has already happened, so it
returns that same old event instantly — every time, forever. A second press would
not help either: the one-per-round rule absorbs it, so no new event is ever
coming for this revision. A "wait again" loop in this state is an infinite loop
with no delay in it. Do this instead:

1. **Tell him what is blocking, by name.** In the review's own threads —
   `retroloop comment add --retro <retroId> --review --text "…" --json` with the
   rids in it — or in a record's own section thread.
2. **Say it in chat too**, with the review URL — a comment on a page he has
   closed is a message he may not see. Name the records and say what you need:
   *"r-slow-tests is back to undecided, so I can't close the review. Give it a
   verdict and I'll finish up."*
3. **Then retry `review close` on a slow cadence** — once a minute is plenty —
   and read its exit code as the answer. **This is the detector**, and it infers
   nothing: exit 0 means every condition actually held, and `FINISH_GATE` names
   exactly who is still undecided, so you can even tell him what changed. Nothing
   is being read out of silence, because the gate is doing the deciding, not you.
   (`review status --retro` reads the same `counts.pending` without attempting
   anything, if you would rather look than knock.)
4. **Give that a budget too**, and end your turn when it runs out — the same
   rule as the wait: report where it stands, hand back the URL and the record
   names, and stop. He may be asleep.

The no-inferring rule is not in tension with this. It forbids concluding he has
*finished a round* from anything but his press; here the press is already
recorded, and what you are watching for is a verdict the gate itself checks.

**He does not need to press Finish review a second time.** His finish is recorded
against the revision and an undo does not retract it, so once every record has a
verdict again, your original `review close` goes through on the finish he already
gave. (If he does press it again, nothing breaks: a second press for the same
round is absorbed.)

A record whose verdict is the legacy `hold` counts as **decided** at both gates —
it never blocks a finish or a close.

### The five record states

| state | what it means |
|---|---|
| `pending` | undecided. The human has not ruled on it — or your rewording sent a decided record back here, which is your doing, not theirs |
| `approved` | agreed |
| `declined` | rejected. A state, never a deletion: it stays in the record and in the export |
| `revise` | **must-address** — "redo this one". The next revision has to answer it, and `review close` refuses while one stands |
| `hold` | history only. It was a verdict for one session and no longer is; nothing writes it any more, and a store may still hold one from before |

A `revise` verdict is the human saying *"redo this one"* about a specific record.
This names them:

```
retroloop record list --retro <retroId> --state revise --json
→ {"retroId": 34, "revision": 1, "records": [{"rid": "r-slow-tests", "num": 2,
    "title": "…", "type": "issue", "state": "revise", "severity": 2,
    "solutionLevel": 3, "selectedSolution": 2, "involvement": "pull-request",
    "carriedOver": false, "decidedOnRevision": 1}]}
```

Without `--state` you get every record of the **latest** revision in the same
shape; `--revision <n>` reads an earlier one instead, which is how you walk a
retrospective's history looking for the highest `num` ever used (§3, identity).
`carriedOver` and `decidedOnRevision` are how you tell "the human decided *this*"
from "the human decided an earlier version of this".

**Read what they actually said before you touch anything.**

**Their verdicts and words, without your own prose in the way:**

```
retroloop revision get --retro <retroId> --feedback-only --json
→ {"retroId": 34, "state": "reviewing",
   "revision": {"n": 1, "createdAt": "…", "records": 5},
   "records": [{"rid": "r-stale-lock", "num": 1, "state": "approved",
                "decidedOnRevision": 1, "contentChangedSince": null,
                "severity": 2, "solutionLevel": 2, "selectedSolution": 2,
                "involvement": "pull-request",
                "reviewerNote": "do this one first"}],
   "threads": […],
   "finishMessage": "Ship the first two; the third can wait for next week."}
```

`revision.records` there is a **count**, not the records; the records are the
array beside it. `reviewerNote` is the human's free channel on a record — read
every one — and `finishMessage` is the same thing for the round, `null` when he
left none. Both are prose he wrote for you and neither is a verdict.

**`contentChangedSince` is on `revision get` and nowhere else** — both this
projection and the full one. `record list` carries `carriedOver` and
`decidedOnRevision` but not this, so "his verdict stopped binding because I
rewrote the record" is a question only `revision get` answers.

**Whose numbers are these?** The `severity`, `solutionLevel`, `selectedSolution`
and `involvement` on a record you read back are **his** once he has ruled — and
**your own proposals echoed back** while the record is still `pending` with
`decidedOnRevision: null`. The state is what tells you which you are looking at;
`reviewerNote` is null until he writes one. Never report your own proposal back to
him as his decision.

**`selectedSolution` is which solution he chose, 1-based into the `solutions`
array you sent** — so `2` is the one the page titled "Solution 2". `solutionLevel`
beside it is that solution's level, not a separate answer he gave. While the
record is pending it shows the one you recommended, which is the same shape as
the other numbers: what is on screen is your proposal until he rules. It is
`null` on a record filed before solutions existed, which had nothing to choose
between.

**An undone verdict reads as pending, and pending shows your proposals again.**
When he takes a verdict back the record's `state` returns to `pending` and every
number on it — severity, involvement, `selectedSolution` and the `solutionLevel`
that follows it — is your proposal once more, not the answer he withdrew. His
withdrawn answer is still in the record's history and is not on this projection.
Do not report it back to him as if it still stood.

**When he picked a solution you did not recommend, that is the finding.** A
record where he chose the level-1 write-it-down over your level-3 build-it is him
telling you what he thinks the fix is worth. Read it, and let it steer what you
propose on the *other* records and in the next session.

**But do not act on it by editing that record's `solutions`.** Moving
`"recommended": true` onto the one he chose, or dropping the ones he did not,
looks like agreeing with him and is in fact destroying his answer: the array is
hashed, so any of those edits sends the record back to `pending` and takes the
pick with it. **Leave the array exactly as you filed it** — his selection is
already recorded, it is already what the export carries, and the record needs
nothing from you. Change a decided record's solutions only when the round asked
you to, and expect to lose the verdict when you do.

**What survives into the next revision.** A verdict binds to the *content* it was
given against, so when you re-file a record unchanged it keeps its verdict and
comes back with `carriedOver: true` and the `decidedOnRevision` it was decided
on. Change any narrative field — title, type, problem, human words, root cause,
workaround, solutions, requester, impacts — and the record is `pending` again
with `contentChangedSince: <k>`, where `k` is the revision he had decided. That is
your doing, not his, so change a decided record only when the round asked you to.

**And everything on it reverts to your proposals, not only the verdict.** A
content-changed record reads exactly like a record he never touched:
`state: "pending"`, `decidedOnRevision: null`, `reviewerNote: null`, and
`severity`, `involvement`, `selectedSolution` and `solutionLevel` all back to
what your new draft proposes. His answers are not gone — the decision he made is
in the record's history and nothing rewrites it — but they are **not on this
projection**, and reporting them back to him as though they still stood would be
telling him a record is decided when the gate says it is pending.

**It is the record going pending that takes his pick, not the solutions edit
specifically.** Rewriting the `problem` of a record whose `solutions` you left
byte-identical loses the selection exactly as rewriting a solution would, because
`selectedSolution` is read off the verdict and the verdict no longer binds. There
is one field you can change freely: `defaults` is outside the hash, so a new
`severity` or `involvement` proposal disturbs nothing.

**Restoring the content restores the verdict.** The binding is a hash of the
narrative, not a one-way door: if a later revision files that record byte-identical
to revision `k` again, his verdict binds again and comes back with
`carriedOver: true`. Which is the real reason to leave untouched records alone —
an "improvement" nobody asked for is a verdict you have to win back.

**`solutions` is in that list, and it is stricter than it looks.** Changing *any*
part of *any* solution — a word of its bullets, a line of its footprint, its
level, which one carries the recommendation, adding a fourth idea, dropping one —
sends the record back to `pending` and his pick with it. It has to: his answer is
a **position** in that array, and a position means nothing once the thing at it
has changed. So re-file a decided record's solutions byte-identical unless the
round asked you to change them, and when it did, expect to have his verdict back
to win. (Keeping the array byte-identical is necessary, not sufficient — the
record still goes pending if you rewrite any other narrative field; see "What
survives into the next revision" above.)

**A ruling is sticky, and your `defaults` cannot overwrite it.** The proposals
seed a record **he has never ruled on**, and nothing else: once a decision exists,
his `severity` and `involvement` are what every read returns and what the export
carries, whatever a later draft proposes. They are outside the content hash too,
so changing them cannot even send a record back to pending. That makes `defaults`
on a ruled record a formality — the field is required, so fill it in, and prefer
his values so the file says what is true. Two cases that need a word:

- **He ruled `involvement: "other"`.** Carry it forward verbatim — `other` is a
  legal value in a draft, and echoing his ruling is not the same act as
  proposing one. The rule in step 3 is about *originating* `other`, which you
  cannot explain because the note that explains it is his.
- **He ruled a `solutionLevel` you may not write** — `none`, `upstream` or
  `undecided`, from before the enum was cut, on a record filed before solutions
  existed. There is no field to carry it forward in, and the old shape cannot be
  filed again. **Which branch you are in depends on whether the round needs a new
  revision at all**, and they are not interchangeable:

  - **The round needs no new revision.** File none. The revision that holds that
    record stays the latest one, so his ruling — level included — is what every
    read and the export return, untouched. This is the only way it survives.
  - **The round does make you file one.** Then the record is in your draft,
    converted to the new shape, and **his ruling does not survive**: the record
    is rewritten, so it goes `pending` and every number on it is your proposal
    again (see "What survives into the next revision" above). Convert it by the
    recipe in "If you do not have the draft file" below — and take the *rethink*
    path there, not the transcribe one, **even though the round did not ask you
    to rethink it, because it is going back to him regardless**. Then say in a
    thread on the record that re-filing it sent it back to him and why the round
    required it, and let him rule on what is now in front of him.

  **What you may never do is leave that record out of a draft you are filing.**
  Omitting it does not preserve anything — it withdraws the record from the
  outcome entirely, verdict and all, silently (step 3, "Dropping a record drops
  it from the outcome"). A record he approved would simply stop existing, with no
  thread and no flag to tell him it had.

**`involvement` says how much of the human this item needs.** `autonomous` is
the solving side's to take; `interactive` and `pull-request` mean it is not to be
done without them. There is no separate hold or parked flag — there was one for
a session and the human removed it, because this field already said it (retro 4
`r-remove-hold`).

There is no `requests` key here and no request command. Requests were a second
ask channel beside the comment threads and the human removed them (retro 4
`r-remove-requests`): **every ask now arrives as a comment**, so `threads` is
where you read them and `retroloop comment add` is how you answer.

Drop `--feedback-only` to get the same document with the record bodies attached
under a `content` key on each record, when you need to see what they were
reacting to. `--revision <n>` reads an earlier round instead of the latest.

### The threads waiting on you

```
retroloop comment list --retro <retroId> --unanswered --json
→ {"retroId": 34, "threads": [{"threadId": 7, "rid": "r-stale-lock",
    "section": "problem", "openedAt": "…", "resolved": false,
    "messages": [{"commentId": 9, "actor": "human", "text": "…", "at": "…",
                  "revision": 1}]}]}
```

`--unanswered` is **"the last message is theirs"** and nothing else — it does not
look at `resolved` at all. Drop it to see every thread; add `--record <rid>` to
narrow to one record.

**`resolved` is whether he has marked the thread dealt with**, and it is a human
field: only he can set it, there is no flag anywhere in the CLI that writes it,
and reading it is the point — it tells you which of his asks are already settled.

- **A resolved thread owes you nothing, even when `--unanswered` lists it.**
  The filter reads only who wrote last, so a thread he settled after his own
  final message still shows up there. `resolved: true` is his answer to it:
  do not reply, and do not treat it as an open ask when you decide whether the
  round needs another revision.
- **Reopening is his act too, and it puts the ask back.** A thread that reads
  `resolved: false` with his message last is waiting on you again, whether it was
  ever settled before or not. Read the flag, not the history.

**`revision` on a message says which revision it was written against.** It is
context, not an expiry date: **a comment from an older revision is still a live
ask** unless the thread is resolved. Filing a new revision settles nothing —
only he does that — so a thread stamped `1` that is still `resolved: false` with
his message last is as much yours to answer in round 3 as it was in round 1.

**A thread with `"rid": null` and `"section": null` is review-level** — an ask
about the retrospective as a whole rather than about one record. It is where the
human's broadest asks arrive, and its `threadId` is the only handle on it.

**Answer in the thread, as yourself. There are three ways to write one, and you
name which:**

```
retroloop comment add --retro <retroId> --thread <threadId> --text "<your reply>" --json
→ {"retroId": 34, "threadId": 7, "rid": "r-stale-lock", "section": "problem",
   "commentId": 11, "at": "…"}
```

- **`--thread <threadId>` answers an existing thread** — review-level or
  record-level, whichever it is. **This is the one to use for anything the human
  opened**, and it is how you answer a review-level ask where he asked it rather
  than in chat (retro 4 `r-cli-review-thread-reply`).
- **`--record <rid> --section <section>` writes in that record's section thread**,
  creating it on first use and reusing it after. `--section` is one of `title`,
  `problem`, `human_words`, `root_cause`, `workaround`, `direction`, `footprint`,
  `solutions`, `defaults`. On a record you wrote, the ones you will use are
  `solutions` and `defaults`; `direction` and `footprint` belong to records filed
  before solutions existed, and exist so their threads still have an anchor.
- **`--review` opens a new review-level thread** for something you want to raise
  about the retrospective as a whole.

```
retroloop comment add --retro <retroId> --record <rid> --section <section> --text "<your reply>" --json
retroloop comment add --retro <retroId> --review --text "<what you want to raise>" --json
```

Name exactly one of the three: none is exit 2 (it is a forgotten flag far more
often than it is a review-level ask), and so is more than one. Use `--file
<path>` or `--file -` for a long reply.

**Every reply opens by replaying what he said, in his own voice** (retro 6
`r-reply-replay-convention`). The rule is his, it is surface-independent, and it
holds here exactly as it holds in chat: on a record thread, on a review-level
thread, and on the thread you open to answer a `reviewerNote`. Before you answer
anything, say back what he said:

1. **Open with the literal line** `**This is what I heard you say written in your
   own voice:**`
2. **Then a blockquote of bullets** — `> - ` lines — carrying everything he said,
   written in **his** first person ("I want the tabs sorted…", never "you want"),
   each bullet opening with a few **bold thesis words** the way every bullet in a
   record does.
3. **Fix the dictation silently.** He speaks his comments, so words arrive
   garbled, sentences restart, a term lands wrong. Repair all of it without a
   note about having done so; never quote a garble back at him, and never ask him
   to confirm a meaning that is already plain.
4. **Replay all of it, not just the part you are answering.** A replay that drops
   half his comment tells him the other half was not read.
5. **Only then answer**, below the quote, in your own voice.

The replay is what makes your answer checkable: he reads one block and knows
whether you understood him before he reads a word of the reply. Four replies in
one round of retro 6 went straight to the answer and cost him a comment to say
so — after the same miss had been reported twice in the legacy system.

```
**This is what I heard you say written in your own voice:**

> - **The solutions should be sorted** from the lowest level to the highest,
>   always, not in the order you thought of them.
> - **The recommended one opens by default**, with a `*` marking that it is
>   your pick and not mine.
> - **The tickmark is mine alone** — it says what I actually chose.

Sorted low-to-high and recommended-open-by-default are both in the design; the
`*` and the ✓ stay two different marks for exactly the reason you name. Filed
as revision 3.
```

Then file revision n+1 with `--expect-revision <n+1>` and wait again — **and
hand it over the same way you handed over the first one**: the new URL, and the
sentence that he has to press **Finish review** before anything reaches you. It
is just as true on round three as on round one, and a human who pressed it once
does not necessarily know he has to press it again. The loop repeats until
nothing is left to address.

### If you do not have the draft file — lost, or never yours

A revision you submitted is not lost with the file you wrote it from — the store
has every record, and `revision get` hands them back in the shape you sent them.
Drop `--feedback-only` and each record carries a **`content` key that is exactly
one record of a revision file**: the same twelve keys as the table in step 3,
nothing to strip, nothing to rename — **as long as the record was filed in the
current shape.** A record filed before solutions existed comes back in the old
one and needs work; that case is spelled out at the end of this section, and it
is exit 2 if you skip it.

```
retroloop revision get --retro <retroId> --json
→ {"records": [{"rid": "…", "state": "approved", …, "content": {"rid": "…", "num": 1,
    "title": "…", "type": "issue", "problem": "…", "humanWords": […],
    "rootCause": {…}, "workaround": "…", "solutions": [{"bullets": "…",
    "footprint": "…", "level": 2, "recommended": true}],
    "requester": "human", "impacts": "human", "defaults": {…}}}]}
```

So the recovery is mechanical **for a record filed in the current shape**: take
its `content`, put it in the array under `records`, and you are holding that
record again. Rewrite
the ones the round asked you to change, leave the rest byte-identical so their
verdicts carry, and submit. Pass `--revision <n>` to reach an earlier round
instead of the latest.

**Byte-identical means the narrative, not the `defaults`.** Only the narrative
fields are hashed, so bringing his ruled values forward into `defaults` — which
step 4 tells you to prefer — cannot disturb a verdict. The two instructions do
not fight.

**`solutions` is narrative, and it is hashed.** Rebuilding a record from its
`content` gives you the array back exactly as you sent it, which is what keeps
his pick valid; retyping one of its bullets "to tidy it" is a rewrite of the
record and takes his verdict with it.

**A record filed before solutions existed comes back in its old shape**, and
that `content` is **not** a revision file any more. Resubmitting it unchanged is exit 2,
reported as **three issues** — the two top-level strangers are grouped into one:

```
revision: records.0.solutions — Invalid input: expected array, received undefined (+2 more)
  records.0.solutions   Invalid input: expected array, received undefined
  records.0.defaults    Unrecognized key: "solutionLevel"
  records.0             Unrecognized keys: "agreedDirection", "footprint"
```

(The summary line quotes the first issue and counts the rest; `--json` gives you
all three under `error.issues`.) So **three keys come out** —
`agreedDirection`, `footprint`, and `solutionLevel` **inside `defaults`**, that
last being the easy one to miss because it is nested — and **one goes in**,
`solutions`. What is left before you add it is a record with eleven keys.

**Which of the two old levels seeds the new one.** An old record has two, and
they are different things: `content.defaults.solutionLevel` is **your** earlier
proposal, and the `solutionLevel` on `revision get --feedback-only` is **his**
ruling. A solution's `level` is a proposal, so it is seeded from yours. His
ruling is not a number you copy anywhere — it is already recorded, and the bullet
above says what happens to it.

**Two ways to do the rebuild, and what brought you here decides which.**
**Rethink** — the deep-dive step of §3 again, proposing the one to three
solutions the record actually has, from scratch — when the round asked you to
rethink the record, *or* when you are converting a record he already ruled with a
level you may not write (step 4, "A ruling is sticky"): that one is going back to
him whatever you do, so it deserves the real answer rather than a transcription
of the old one. **Transcribe** only when neither is true — you are here because
you do not have the draft, the round asked for nothing on this record, and the
point is to put back what was already there. Then the smallest honest rebuild is
**one solution**: the old `agreedDirection`
becomes its `bullets`, the old `footprint` becomes its `footprint`, its `level`
is the `solutionLevel` the old `defaults` carried, and it is
`"recommended": true` because it is the only one. Two exceptions:

- **Your old proposed level is `none`, `upstream` or `undecided`.** Those were
  proposable once, until the human cut the list to `1`–`5`, and there is no
  conversion rule — decide the level yourself, `1`–`5`, the way you would for a
  new record.
- **He already ruled on it.** His verdict is bound to the old content, so
  rewriting the record into the new shape sends it back to `pending` however
  faithful the rebuild is. There is no way around that and no reason to hide it:
  say so in a thread on the record, and let him rule on what is now in front of
  him.

**The retro's name is not in any read you have.** It is on the review page,
in the header, so the one way to recover it is to **ask the human to read it off
the page** — give him the URL and ask for the line under the breadcrumb. If he
would rather not, write a new one by the same rule as any other (§3, "the title
names the work this retro covers") and say in a review-level comment that you
renamed it and why, so the rename is his to object to.

**Re-author the `title` — nothing gives it back to you.** The revision's title is
not in `revision get`'s output, or in any other read, so a draft rebuilt this way
has none. That matters: the retrospective's name is *the latest revision's*
title, so filing an untitled revision n+1 takes the name off a retro that had
one. Write the title again — the same one, unless the retro is now about
something else.

The keys *around* `content` — `state`, `carriedOver`, `reviewerNote` and the rest
— are the human's side of the record and belong to no draft. Sending one back is
exit 2.

If the feedback is genuinely unreadable — a note you cannot parse, a comment you
do not understand — **ask the human what they want changed**, in the thread or in
chat. Guessing produces a revision they have to review again for no reason.

## 5 · When nothing is left to address: close it, then export

Closing is the one act you have on a review, and it is mechanical: it says
*"there is nothing more to address"*, nothing else. It refuses (exit 4) unless
the human finished this very revision, every record is decided, and none of them
asked to be rewritten — so if it refuses, re-read the round rather than working
around it.

```
retroloop review close --retro <retroId> --json
→ {"retroId": 34, "state": "finished", "revision": 2, "finishedAt": "…"}
```

Then take the receipt:

```
retroloop export --retro <retroId> --out <path> --json
→ {"path": "…", "records": 4, "bytes": 8123}
```

**The order is not a style.** Export before the close is exit 4 —
`retrospective 34 is reviewing; only a finished review can be exported` — because
the document asserts `state: "finished"` and a verdict on every record, and
neither is true yet. There is no preview form and no partial export: close first.

`--out` takes any path you can write; give it a **`.json`** extension, because
that is what it writes. With `--out` you get the receipt above and the document
goes to the file; without `--out` the document itself goes to stdout and there is
no receipt. `--state <state>` narrows it to one of the five record states —
`pending`, `approved`, `declined`, `revise`, `hold` — when what you want is the
work list rather than the whole outcome.

**What the file contains.** One JSON object, `retro.export.v1`, with seven
top-level keys — you never author it, but you may be asked what is in it:

```json
{
  "format": "retro.export.v1",
  "generatedAt": "2026-08-25T14:44:13.948Z",
  "project": null,
  "session": { "id": 12, "claudeSession": "…", "project": null, "cwd": "…",
               "branch": "main", "supervised": true, "startedAt": "…" },
  "retrospective": { "id": 34, "title": "…", "state": "finished",
                     "finishedAt": "…", "revisions": 2, "reviewed": "human" },
  "records": [ … ],
  "reviewThreads": [ … ]
}
```

Four keys of that shape are worth a word, because you never author any of them:

- **`retrospective.id` is the `retroId`** — the address you have been passing to
  every command, not the "Retro #n" position you printed to the human. The
  position is **not in the export at all**, so a reader of the file who wants it
  has to count the session's retrospectives themselves. The example gives the
  session and the retrospective different numbers on purpose; they are unrelated
  counters and a document where they happened to match has misled people before
  ("The names and numbers you will be handed", above).
- **`project` and `session.project`** are the same optional annotation from
  `session create`, repeated once for the document and once inside the session it
  describes.
- **`retrospective.reviewed`** is the constant `"human"`, stated rather than
  stored — only the human ever finishes a review, so there is no other value it
  could take.

Each entry in `records` is one record's final state: its `rid` and `num`, the
whole narrative you authored including every `solutions` entry, the `state` he
ruled, **his** `severity`, `selectedSolution`, `solutionLevel`, `involvement` and
`reviewerNote`, and the record's own comment threads. A record filed before
solutions existed carries `agreedDirection` and `footprint` there instead, which
is why a consumer reading the file has to expect either shape. Declined records are in there too — decline is a state, not a deletion.
`reviewThreads` carries the threads that hang off no record. Tell the human where
it landed, and stop. The retrospective is filed.

**After the close, the retrospective is done for good.** It takes no more
comments (exit 4), no more revisions and no second close. A later
`revision create` on the same session opens a **new** retrospective: its
revisions start again at 1, and its `retro` position number is one higher than
the last one's — the retrospective you just filed keeps its `retroId` and its
records forever.

## What you must never do

- **Never decide a record.** Approve, decline, revise, the reviewer's note, the
  *decided* severity and involvement — all the human's, all UI-only. There is no
  flag for any of it, and no wording of a comment counts as one. You propose both
  of those two in `defaults` and you should (step 3); his ruling is what counts.
- **Never choose the solution.** You propose one to three and mark one
  recommended; **which one is built is his**, and so is the level that comes with
  it. Recommending is not choosing, a record where only one solution is worth
  proposing is still his to accept, and no comment saying "we should obviously do
  Solution 3" makes the choice for him. He may pick the one you did not
  recommend, and when he does, that is an answer and not a mistake to correct.
- **Never finish or reopen a review.** `ReviewFinished` comes from his
  **Finish review** button and nowhere else. Closing a review *is* yours
  (step 5) and is a different act: it files an outcome he has already given, it
  decides nothing, and it refuses if he has not given one — which is why the
  retrospective reads `finished` afterwards without you ever having finished a
  review.
- **Never infer approval from silence.** No answer is not a yes. If the wait
  times out, say so and wait again or stop; do not proceed as though the human
  agreed.
- **Never stand the finish watch down while a review is open.** A watcher killed
  or exited is **re-armed**, on the kill notification itself; a kill is a fact
  about the task system and never a gesture, never a request to stop, and never
  permission to hand the notification burden back to him. The watch ends at
  `review close` or on his explicit word, and on nothing else. If you are
  watching with anything less than a certified bridge, the handoff SAYS the
  bridge is interim and names its failure mode — silence must never be
  mistakable for a channel that works (step 3, "The bridge").
- **Never read `--with-human` outside step 3.** The human's notes and
  annotations are for drafting time only. There is nothing stopping you — that
  is why it is written down here.
- **Never edit a revision.** They are immutable. Corrections travel as a new
  revision — that is what the loop in step 4 is.
- **Never rename or renumber a record.** The `rid` and `num` a record was minted
  with are what every verdict and every thread hangs off.
- **Never write a field the shape no longer has.** `agreedDirection`,
  `footprint` and `solutionLevel` inside `defaults` are all exit 2 now (step 3);
  a record proposes `solutions`, and each one carries its own words, files and
  level. Reading those keys back off an old record is not permission to write
  one, and neither is reading back a level outside `1`–`5`: `none`, `upstream`
  and `undecided` are history in every direction but the read.
- **Never file `{"records": []}`, and never originate `involvement: "other"`.**
  The empty array is exit **0** and is the dangerous one: it files a revision
  that replaces the round with nothing to review (step 3). With nothing new to
  say, file no revision at all. And `other` means "the reviewer's note says
  what", which is his field and not yours — propose the closest real mode and
  say what you mean in the recommended solution's bullets.
