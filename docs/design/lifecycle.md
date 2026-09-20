# Lifecycle

Every state machine in Retro, one per entity, in one place. A retrospective has
one. A record has **two, and they are independent**. A comment thread has one.

This file is normative for *what the states are and who may move between them*.
Where the data lives is `data-model.md`; who may write what is `architecture.md`
§Actor model.

**Reading this file.** Bare file names (`close-review.use-case.ts`) and
identifiers (`refuseWhenFinished`) are unique in the tree and are meant to be
searched for rather than pathed. `L1` and `L3` name layers: L1 is the database
(SQLite triggers), L3 the use cases — so "refused at L3 and backstopped at L1"
means the rule is enforced in code and the database would refuse it too. A
**revision** is one complete AI-authored draft of a retrospective's whole record
set; a retrospective has one or more, and a record changes only by appearing in a
new one (`data-model.md` §Revision). "The human", "the user" and "the reviewer"
are the same one person, who is the product's only human actor.

Two rules run through all of it and are worth stating before the machines:

- **Nothing is inferred from silence.** No state is entered because a commit
  mentioned something, a session ended, or a reviewer said nothing. Where an
  absence *is* read as a state, it is read in the safe direction — as *nothing
  having happened* — and this file says so at each of the two places it happens.
- **Human data is append-only.** No machine here has an edge that overwrites or
  deletes anything. Every act somebody *takes* is a new row, so the path a thing
  took stays readable forever, and "decline is a state, not a deletion" is true
  of every entity. Two transitions are taken by nobody and write nothing — a
  verdict falling back to `pending` under rewritten content, and a declined
  record reading as archived — and each is called out where it happens.

---

## Retrospective — `open → reviewing → finished`

The container: one capture-and-review cycle inside a session. A session has one
or more, and **exactly one may be non-`finished` at a time**.

```
  open ──first revision──▶ reviewing ──ReviewClosed──▶ finished
                            │     ▲                      (terminal)
                            └─────┘
                        any further revision
```

| From | To | What causes it | Who |
|---|---|---|---|
| `open` | `reviewing` | the retrospective's first revision is filed | ai |
| `reviewing` | `reviewing` | any further revision | ai |
| `reviewing` | `finished` | `ReviewClosed` — the AI's explicit close to export | ai |

`open` is **transient and never observed**: a retrospective is started and its
first revision written in the same unit of work, so no persisted retrospective is
in `open` unless that unit of work rolled back.

**`ReviewFinished` is an event, not a transition.** The human's one button closes
the human side of a round and leaves the retrospective `reviewing`. Between that
finish and the AI's close the human may still change a verdict, undo one, or add
a comment — that window is deliberate, and it is why the close asks the finish
gate again rather than trusting the answer the button gave.

Pressing Finish is refused while any record of the latest revision is still
`pending`; **a second press for the same revision is absorbed** — no second
event, no error. That is the opposite of the thread rule below, where re-marking
is another row: a round ends once, and a thread is a conversation somebody can
keep having an opinion about.

The close is gated three ways (`close-review.use-case.ts`), and refuses unless
all three hold for the latest revision:

1. the human has finished **that revision** (a `ReviewFinished` for its `n`);
2. no record is `pending` — the verdict is **total**;
3. no record asks to be rewritten — no `revise` survives into an export.

`finished` is terminal. There is no reopen edge anywhere in the product.

### `submitted` — a fourth word, and not a fourth state

A reader needs a word for the window between `reviewing` and `finished` — one
that says the human has finished but the AI has not closed yet. That window is
the one the paragraphs above describe: after `ReviewFinished`, before
`ReviewClosed`. Before the fourth word existed, nothing said so — the dashboard
row and the review header both read REVIEWING for the whole of it, and the only
surface that knew was the review bar's Sent mark, at the bottom of a page the
reviewer had already left.

So the **read models** answer with a fourth word, and the machine above is
untouched:

| Reading | When |
|---|---|
| `open` | stored `open` |
| `reviewing` | stored `reviewing`, latest round not finished |
| `submitted` | stored `reviewing`, **latest** round finished |
| `finished` | stored `finished` |

Nothing stores it, no migration carries it, and no event produces it — it is
derived on every read from the `ReviewFinished` rows that were already the only
record of the act (`packages/core/src/application/views/retro.view.ts`;
`retros.get`, `retros.list`, `review.finish` and `review status` all use that one
function). A store never holds the word: `RETROSPECTIVE_STATES` is still three,
and it is the `retroDisplayStateSchema` beside it that is four.

**The latest round is the one that counts.** A round finished two revisions ago
was answered by the draft that followed it, and the retrospective is the human's
again — so filing a revision takes the word away without anything having to
remove it.

Two things the word does **not** move. `review status --json` keeps its
`finished` boolean on the stored terminal state, so a script that keyed off it
before keys off the same thing after. And the window stays writable: the human
may still change a verdict, undo one, or comment — including undoing one back to
`pending`, which leaves a `submitted` retrospective with a pending record in it
and is why the AI's close asks the finish gate again rather than trusting the
button.

---

## Record — two axes, and they never write each other

A record has a **verdict** and a **status**, and confusing them is the mistake
this product has already made once — in two steps, which are worth telling apart
because both left traces in the schema:

1. **`hold` came off the verdict axis.** It had been a fifth `DecisionState`, and
   a hold is not a review status of a record at all. It became a separate flag
   with its own table, and the stored `hold` verdicts stayed where they were —
   see §The verdict machine.
2. **Then the flag itself was removed**, feature and all: what the flag meant was
   already `involvement` — the dial that rides on the verdict saying how much of
   the work the AI may do alone, up to "not without me in the loop". Marking a
   record as one to do only with the human in the loop achieves everything the
   flag did.

So there are two dead things called "hold": a verdict nobody can write, and a
feature nobody can reach. The two axes below are the settled shape that replaced
them.

| | Verdict | Status |
|---|---|---|
| answers | *should we do this?* | *has it been done, and is it still worth looking at?* |
| scoped to | the **review** | the **record**, for its whole life |
| settled | total at close, frozen after | never — it goes on moving after the close |
| written by | human only | both actors, per act (below) |
| read off | the latest `decisions` row **that still binds** | the latest `record_lifecycle` row, or the verdict where there is none |

**Neither is stored as itself.** Both are *derived* readings of append-only rows:
a `decisions` row holds a verdict and the content hash it was given for, and a
`record_lifecycle` row holds an **act**, not a state. So `record_lifecycle.status`
says `resolved | reopened | archived | unarchived` while a record's status is
`open | resolved | archived` — four acts, three states, and the mapping is the
table in §The status machine. Nothing anywhere stores "this record is archived".

**Neither may write the other, ever.** A verdict does not resolve a record; a
resolve does not decide one. The one place they touch is a *reading*: a declined
record with no lifecycle entry reads as `archived`, which is derivation and not a
write — §Born archived says exactly what that means and what it does not.

### The verdict machine — review-scoped, and frozen at the close

```
  pending ──approve──▶ approved ─┐
     ▲   ──decline──▶ declined ─┤
     │   ──revise ──▶ revise   ─┤
     └──────────── any verdict ─┘   (every edge is a new version)
```

Four positions: `pending` (nobody has decided), `approved` (do it), `declined`
(do not), and `revise` — **the reviewer asking for the record itself to be
rewritten in the next revision**, which is an instruction to the drafting AI
rather than an outcome, and is why the close refuses while one stands.

Any of them may be submitted from any of them, including `pending` itself —
re-pressing the selected verdict submits `pending`, which is what an undo is
here: one more append, never a row anybody edits.

**Latest wins, against the content it was given for** — "carry-over". A decision
stores the hash of the record content it was made against
(`content-hash.service.ts`). Reading it back:

- content unchanged → the decision **binds**, and carries forward across
  revisions (`carriedOver` says it was made against an earlier one);
- content changed → the record is **`pending` again**, and nothing was written to
  make it so. Pending *is* the absence of a decision for the current content.

That reset writes nothing, which is what keeps "explicit approve only" true: every
approval that carries was an explicit human act against byte-identical content,
and nothing in this system can invent one.

**`hold` is a fifth position that no one can write.** It was a verdict until it
left the axis (step 1 above), and every read path still admits one — the wire
views, the export, a record's decision history, the table's own CHECK — because
human data is append-only and real stores hold rows carrying it. The **input**
enum, `decisionVerdictSchema`, is the four above and refuses it. If you see one:
read it, render it, never write another. A record carrying one is born `open` on
the status axis, like everything that is not `declined`.

The same narrowing was done once before, to `solutionLevel`: the values that were
cut stayed readable forever and left the write path. Narrow the write path, never
the read path.

**Total at close, frozen after.** The close refuses while anything is `pending`
or `revise`, so a closed retrospective has a verdict on every record; and
`RecordDecisionUseCase` calls `refuseWhenFinished`, so no verdict changes after
that. An export is taken from a finished retrospective and a document that could
grow new verdicts behind its reader is a document nobody can cite.

### The status machine — open · resolved · archived

The axis that outlives the review. It starts being interesting exactly when the
verdict stops.

```
              ┌──────────── archive ────────────┐
              │                                 ▼
   ┌────▶ open ──resolve──▶ resolved ─archive─▶ archived
   │        ▲                   │                  │
   │        └────── reopen ─────┘                  │
   └──────────────── unarchive ────────────────────┘
```

Three **states**, four **acts**, and they are different types on purpose: two
acts land a record on `open`, and a reader asking "is this still owed?" wants the
same answer from a reopen and an unarchive.

**All four acts are available from the moment the record exists**, not only after
the close. Nothing gates them on the retrospective's state in either direction —
that is what "for its whole life" means in the table above, and it is why the
finish lock has an exception rather than this axis having a start line.

| Act | Legal from | Leaves it | Cites refs | Who |
|---|---|---|---|---|
| `resolved` | `open` | `resolved` | **at least one, required** | ai or human |
| `reopened` | `resolved` | `open` | none | ai or human |
| `archived` | `open` or `resolved` | `archived` | none | **human only** |
| `unarchived` | `archived` | `open` | none | **human only** |

**An act taken from a state that does not permit it is a `ConflictError`**, never
a silent no-op. Answering "done" to an act that did nothing is the quiet
inference this product refuses everywhere else: the caller believed the store
said something it did not. (Note the consequence: resolving an already-resolved
record is refused, so amending a fix's references means reopening first — and the
history then reads as the two acts it was.)

**References are evidence, and only a resolve makes a claim that needs any.** A
resolve carries at least one — a commit id, an issue link, or anything else that
makes the fix easy to see — and every other act carries none, refused rather than
dropped. So the references **on the entry in force** are non-empty exactly when
the status is `resolved`, and a reader of the current state may treat "has
references" and "is resolved" as one question. The references a superseded
resolve cited are still in the record's history, and no read path shows that
history today.

**Every act appends a version.** Archiving is **not a delete** and never becomes
one: keeping the record's discussion readable is the whole reason the state
exists. Nothing anywhere removes a record.

**This axis is not closed by the close.** `SetRecordLifecycleUseCase`
deliberately does not call `refuseWhenFinished`, because the axis exists
*because* the retro is closed: metadata that manages a record's life cycle has to
be attachable after the review it came from is over. It endangers nothing the
finish lock protects, because lifecycle is **not exported**: the document taken
from a finished retrospective is the same document before and after. Carrying
lifecycle into the export is on the deferred list, and that is the one change
that would put this exception back in question — if it lands, the export has to
answer for a document that can change behind its reader, and this paragraph is
the thing to revisit first.

**"In progress" is a marker beside this axis, not a fourth position on it.**
Somebody working on a record writes a row in `record_claims`
(`data-model.md` §Record claims) and the status machine above does not move: a
claimed record is `open`, because it is still owed. The two are different kinds
of fact — every value on this axis is a settled thing somebody reported, with
references where a claim is being made, while "an agent has this right now" is
true for an afternoon and then is not. The word `in-progress` exists only in the
**lane state**, which is the one word a queue row is called by
(`record-lane.service.ts`): it folds the verdict, this axis and the marker, and it
is a reading rather than a stored value, exactly like `submitted` one entity up.
The precedence there is `resolved` first, then an `archived` somebody actually
took, then the claim, then the verdict — so a resolve outranks a marker nobody
took down, and a declined record reads `declined` rather than `archived`. A
resolve clears the claim in the same unit of work, which keeps the two from
disagreeing in the first place.

**Archived does not mean hidden.** The records page shows archived rows like any
other and its lifecycle chips are what narrow the list — keeping the discussion
readable is the reason the state exists, and a row nobody can find is a
discussion nobody can read. What each state offers on the row is the transition
table above: a control the server would refuse is a control that is not on
screen.

#### Born archived — the one derivation, and its exact limits

A record with **no lifecycle entry at all** is `open`, except a **declined** one,
which is `archived`. A record declined during the review is one whose discussion
is still worth keeping but which nobody is going to act on, and that is exactly
what `archived` says; every other verdict leaves a normal record.

Four things this is, precisely:

1. **It is derived, and nothing is written at the close.** No archive row is
   created for a declined record, ever. That is what makes a store closed long
   before this feature existed answer identically to one closed after it, and it
   is why unarchiving a born-archived record writes **version 1** like any other
   first act.
2. **The verdict speaks only into an absence.** One entry exists and the entry in
   force is the only thing that answers. An unarchived declined record is `open`
   and stays `open`; it does not spring back to `archived` behind its reader.

   The corollary, stated because it is the one edge on this page with no actor
   beside it: **while a record has no entry, its status follows its verdict, and
   moves when the verdict moves.** A record declined and then set back to
   `pending` during a round reads `archived` and then `open` again, with no
   `unarchived` act and no human-only gate — because there was no act, and the
   human-only gate is on *acts*. Nothing is written in either direction, so this
   is not the verdict axis writing the status axis; it is one derived reading
   changing because the row it derives from changed. It is also almost entirely
   a pre-close phenomenon: verdicts are frozen at the close (§The verdict
   machine), so a record's birth state stops moving exactly when anyone starts
   caring about its status.
3. **It is not an inference from silence.** The safe-direction rule is about
   *acts*: silence about acts is read as nothing having been done. Born-archived
   reads something the human explicitly did — the decline itself.
4. **Every other verdict is born `open`**: `approved`, `revise`, a stored legacy
   `hold`, and `pending` on a review that has not closed.

**The consequence worth knowing before you hit it:** a declined record starts
`archived`, and `resolved` is legal only from `open` — so **a declined record
cannot be resolved until a human unarchives it**, and unarchiving is human-only.
An AI that fixes something the review declined cannot record the fix on its own;
it needs the human to bring the record back first. That follows from the two
rules above rather than being a rule of its own, and it is a narrowing: before
the archive pair existed, any record could be resolved whatever its verdict said.
It is stated here rather than worked around, because the alternative — letting a
resolve reach an archived record — would mean a record could be `resolved` and
`archived` at once, and the axis has one position at a time.

#### The actor rule, per act

`record_lifecycle` is the **one** append-only table both actors write, which is
why it is the one with an `actor` column. But that was decided for *resolving*,
which is a report of work the AI did. Archiving is a judgment about what is worth
looking at, so both archive and unarchive stay with the human.

So the rule is per act rather than per table, and it is enforced **in the use
case**, above the transaction — not at a transport. The browser is
unconditionally `human` and the CLI is unconditionally `ai`, so a transport-level
guard would be an accident of who happens to call today. `retro record archive`
exists and is refused with `FORBIDDEN_ACTOR` (exit 5), naming the rule.

#### Nothing else may write status. Ever.

This is a standing constraint on features that do not exist yet, and it is here
so nobody has to rediscover it:

- **No label or tag mechanism may write status.** Labels and tags were deferred
  out of round one rather than ruled out. When they arrive they are a *third*
  thing beside the two axes: a label named "archived" must not archive, and
  archiving must not apply a label.
- **No automation may write status.** No commit message, no merge, no CI result,
  no session ending, no export. Every row is an explicit act by a named actor.
- **The two axes never write each other**, in either direction — restated here
  because the pressure runs both ways: a future "close out everything declined"
  would be the verdict writing status, and a future "archiving declines it" would
  be status writing the verdict. Both are refused by this document.

---

## Comment thread — `open ⇄ resolved`

```
   open ──resolve──▶ resolved
     ▲                  │
     └───── reopen ─────┘
```

The grain is the **thread**, because that is what the panel shows: a top-level
comment *is* a thread and its replies belong to it.

- **Human only.** Marking a thread resolved is the human's act and never the
  AI's: `ResolveThreadUseCase` asserts the actor as its first statement, below
  every adapter, and the table's append-only triggers back it up at L1. There is
  no CLI flag that reaches it.
- **Append-only.** Reopening writes another version. Marking a thread the way it
  already stands is still a row, because the human doing it again is a thing that
  happened.
- **No revision.** A thread outlives every redraft of the record it hangs off, so
  "I have dealt with this" does not stop being true because a paragraph was
  rewritten. What binds to a revision is the comment, not the verdict on the
  conversation.
- **Closed by the close.** Unlike the record's status axis, this one refuses on a
  finished retrospective — an export carries the threads, and a document whose
  threads could change state behind its reader is a document nobody can cite.

---

## The finish lock, and the one thing about it that is hand-maintained

`refuseWhenFinished` (`finish-lock.service.ts`) is what makes a finished
retrospective read-only. **Every write path on a retrospective calls it, with
four deliberate exceptions**, each of which exists *because* the retro is closed:

| Exception | Why it is exempt |
|---|---|
| `records.setLifecycle` | the record status axis above, for the reason that section gives |
| `labels.apply` | moving a record to an external tracker and labelling it "migrated" happens after the close by construction |
| `attributes.set` | the same archetype, carrying the ticket id beside the label |
| `records.relate` | either actor may relate records so past records are easy to find, and the far end of a relation is normally in a retrospective that closed long ago |

**All four are safe for one shared reason: none of them is in the export.** A
document taken from a finished retrospective still cannot change behind its
reader. That is a bargain rather than an accident, and every one of the four pays
it by staying out of `export.view.ts` — the relation most explicitly, since a
relation *can* be authored after a document was taken, which is exactly why it is
not in one.

**The guard is actor-blind.** It reads the retrospective's state and nothing
else, so it refuses the AI exactly as it refuses the human — an AI reply into a
thread on a finished retrospective is refused by the same line that refuses the
human's comment. It is described as protecting *human* writes because human
writes are what a finished retrospective would otherwise still attract; the AI's
next move on a finished retrospective is to start a new one, which is a different
retrospective and not a write to this one.

Four use cases call it today — `RecordDecisionUseCase`, `AddCommentUseCase`,
`ResolveThreadUseCase`, `FinishReviewUseCase` — and the same four are enumerated
by procedure name in one test: `review.test.ts`, *"after the review is closed →
no human write is accepted at all"*, naming `decisions.record`,
`threads.addComment`, `threads.resolve`, `review.finish`. The test beside it
names the four exceptions and exercises each one against a closed retrospective,
because a claim about a set is only worth as much as its exceptions being named
in the same place.

**The close is not among them and does not need to be.** `CloseReviewUseCase`
writes to the retrospective — it is the thing that makes it `finished` — and
guards itself with its own refusal (*"already finished"*) rather than through
this function, because a terminal transition refusing to be taken twice is a
different statement from a document refusing to change after it is published.
`revision create` is not among them either: on a session whose last
retrospective is `finished` it starts a **new** retrospective, so it is never a
write to the finished one.

**That enumeration is hand-maintained, and nothing checks it is complete.** No
mechanism derives the list from the router, the use cases or the app, and nothing
checks the test's list against the call sites either; a fifth write path added
tomorrow would pass every test in the repository while being reachable on a
finished retrospective. The list was two procedures wider once (`holds.set`,
`holds.clear`) and shrank by hand when the feature was removed; the exception
list beside it has grown by hand three times since, most recently for
`records.relate`.

So the maintenance rule, stated because the enforcement does not exist:

> **A new write path on a retrospective joins the enumeration in
> `review.test.ts` in the same commit that adds it** — and either calls
> `refuseWhenFinished`, or is added to the exception above with its reason
> written down here.

Deriving the list mechanically is the obvious improvement and has not been
built; treat this paragraph as the marker for whoever does.
