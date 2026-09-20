# Data model

Integer primary keys everywhere. Records use a stable slug `rid` plus a
**position** `num` inside their retrospective — minted once, never renumbered,
never reused — and a **global** `id` from one sequence over the
whole ledger, which is the number a reader is shown (§Record ids). Actor
enforcement and append-only guarantees per `architecture.md` §Actor model.

State machines — the retrospective's, the record's two, the thread's — are in
`lifecycle.md`, one per entity. This file is where the data lives; that one is
what may move it.

> **The model is flattened to sessions + retros.** `project` is a dormant
> optional string — no Project entity, nothing groups by it; **`session.cwd` is
> the identity anchor** (immutable, a Claude Code invariant). A retrospective
> gains an AI-authored **`title`** carried on the revision payload (latest
> revision's title wins; fallback "Retro #n — <cwd basename>"). The retro's
> 1-based ordinal within its session is display identity; the autoincrement id
> is the address.

## Entities

```
Project (name)                        — dormant optional string on Session (no project construct)
Session 1─n Retrospective 1─n Revision 1─n Record(embedded)
Session 1─n Note(ai|human) 1─0..1 Annotation (on AI notes, human-authored)
Retrospective 1─n Request             — removed as a feature; rows are history
Record  1─n Decision(version-append)  1─n CommentThread 1─n Comment
Record  1─1 RecordId                  — the global number, minted once, outside the revision blob
Record  1─n RecordLifecycle(version-append) — the second axis: resolved/reopened/archived/unarchived
LabelDefinition      — global vocabulary, mutable, retired rather than deleted
AttributeDefinition  — the same, plus a fixed type
Record  1─n RecordLabel(version-append)          — which labels it wears, human-only
Record  1─n RecordAttributeValue(version-append) — what it carries, human-only
RecordId n─n RecordId  via RecordRelation(version-append) — how two records relate, either actor;
                        the one edge in this diagram that crosses retrospectives
Setting(version-append) — the global settings; one key, `ai_config_write`
Record  1─n Hold(version-append)      — removed as a feature; rows are history
Retrospective 1─n CommentThread       — review-level threads (no record)
Retrospective 1─n FinishMessage(version-append) — the human's final word on a round, keyed (retro, revision)
Event   — appended in the same transaction as every write (outbox)
```

## Session

| field | type | writer | notes |
|---|---|---|---|
| `id` | int | system | |
| `claudeSession` | uuid | ai | idempotency key for `session create` |
| `project` | string? | ai | optional + dormant — nothing may build on it |
| `cwd`, `branch` | string | ai | |
| `supervised` | bool | ai | session-level fact, never per record |
| `startedAt` | timestamp | system | |
| `status` | `active \| reviewing \| finished` | derived | from its retrospectives |

## Retrospective — state machine

`open → reviewing → finished` — the machine and its gates are `lifecycle.md`
§Retrospective; what follows is the same shape with the data around it. Three
values are what a row ever holds; readers are shown a fourth, `submitted`,
derived per read and never written (`lifecycle.md` §submitted).

- `open → reviewing`: first `revision create` of this retrospective.
- `reviewing → reviewing`: any further revisions. **`ReviewFinished` does not
  change state either** — it is the human's one button saying *the human's side
  of this round is closed*, and it unblocks `review wait`. (`ChangesRequested` did the
  same job for the second button; nothing appends one since that button was
  removed.)
  **Finish gate:** refused while any record of the latest revision is `pending`
  (every record must be `approved | declined | revise`).
  **Once per round:** a second press for the same revision is absorbed — no
  second event, no error, so a mis-press costs one press.
  **The round's final message:** the press may carry one — see §Finish message.
- `reviewing → finished`: **`ReviewClosed` — the AI's explicit close to export**,
  terminal. It is the AI's step because the choice it encodes is readable from
  what the human wrote, not from which button was pressed: there is one button,
  the human finishes the review, and the AI then reads what was requested and
  either sends a new revision or confirms there are no new requests. Three
  mechanical guards, no judgment:
  a `ReviewFinished` for the **latest** revision must exist, the finish gate must
  still hold, and no record may carry `revise` (that ask must be addressed in the
  next revision).
- **Between the finish and the close the human may still write** — change a
  verdict, undo one, add a comment. That is why the close re-asks the gate
  instead of trusting the answer the finish got.
- **After `finished`, the retrospective itself takes no more writing.**
  Decisions, comments and thread resolutions are refused — and refused for the
  **AI as well as the human**, because the guard reads the retrospective's state
  and never the actor. The guard is one function, `refuseWhenFinished`, and every
  write path on a retrospective calls it — with **one deliberate exception**, the record's lifecycle axis,
  which exists precisely because the retro is closed (§Record lifecycle;
  `lifecycle.md` §The finish lock). `holds.set` and `holds.clear` were a second
  exception for a time and went with the hold feature when it was removed.
- Exactly **one non-`finished` retrospective per session**; `revision create` on a
  session whose last retrospective is `finished` starts a new one.
- **The human's outcome is an explicit UI action, and the AI's close is a
  mechanical act that can only follow it.** Nothing is ever inferred from
  silence, absence of comments, or time passing: the AI never decides a record,
  and it cannot close a review the human has not finished.

## Revision

Immutable once created. `n` starts at 1 per retrospective; `--expect-revision`
gives an optimistic check (`ConflictError` → exit 4).

| field | type | notes |
|---|---|---|
| `retroId`, `n` | int | unique per retro |
| `createdAt` | timestamp | |
| `title` | string? | AI-authored; the retrospective's plain-language name, trimmed, 1–80 chars |
| `records[]` | Record | embedded, ordered by `num` |

**The retrospective's title is the latest revision's title** (null when the
latest proposed none). A title rides on the draft, so renaming a retro means
redrafting it — the same rule everything else in a revision obeys. It is
AI-authored and never a bare number; readers fall back to
"Retro #n — <cwd basename>". `retros.get`, `retros.list` and the export carry
it; the dashboard rows and the review header render it.

## Record (embedded in a revision)

**Identity** (minted at first appearance in the retrospective, stable across revisions):

| field | type | notes |
|---|---|---|
| `rid` | slug | `r-<words>`; never reused. Half of the address — see below |
| `num` | int | its **position within its own retrospective**; dense per retrospective; never renumbered. Still real, no longer the number a reader is shown (§Record ids) |

**`(retroId, rid)` is what addresses a record, everywhere.** A rid is minted per
retrospective and is **not** globally unique: `r-flaky-test` is a plausible slug
in two different retrospectives, and every table that hangs off a record is keyed
on the pair for that reason. The one page that holds several retrospectives'
records at once (`/records`) is where keying on the rid alone would first bite.

### Record ids — one sequence over the whole ledger

Record numbers that restart at #1 inside every retrospective are ambiguous
across the ledger, so the number a reader is shown comes from one global
sequence rather than a per-retrospective one.

`record_ids` is a table of `(retro_id, rid) → id` with `UNIQUE (retro_id, rid)`
and the append-only triggers, so a number is minted once and never moves. It is
minted **at a record's first appearance** in a revision, inside the same
transaction as the revision. Its `id` is the number every reader shows a person —
the records page, the review rail, the record card, a thread's anchor and its
composer, the finish refusal, `record list`.

Three properties, each load-bearing:

- **The revision blob is untouched.** `num` stays what the AI authored and what a
  resubmitted draft must keep saying; `id` is minted by the store and is not part
  of a draft at all. So the number cannot enter the content hash, and numbering a
  record cannot un-decide it.
- **Minted once, never moved.** A record that disappears from a later revision
  keeps its number; one that comes back gets the same one.
- **Addressing did not change.** Every write is still `(retroId, rid)`. The
  global id is shown, never sent.

The export carries it as an **additive optional** `globalId`, so every historical
export stays valid unmodified.

**Narrative** (AI-authored, immutable; changes only by appearing in a new revision):

| field | type | notes |
|---|---|---|
| `title` | string | one line |
| `type` | `issue \| feature` | |
| `problem` | markdown | problem + impact, self-contained |
| `humanWords[]` | `{verbatim, cleaned, context}` | every quotable instance; both halves required |
| `rootCause` | `{whatHappened, whys[1..5], root}` | five-whys |
| `diagnosticData` | markdown | the evidence diagnosed from — logs, timings, commands run; required on every record filed since the field was introduced, `undefined` on every record filed before |
| `workaround` | string | free text or literal `"none"`; never absent |
| `solutions` | `Solution[1..3]` | one to three ways to solve it — see below |
| `requester` | `human \| ai` | who raised it |
| `impacts` | `human \| ai` | primary impact (v2 semantics) |

**Solutions — the multi-solution design.** The AI deep-dives and proposes up to
three solutions; where the fix is quick, one or two is all that makes sense. A
record no longer carries one agreed direction and one footprint; it carries a
**choice**, and the human makes it.

| field | type | notes |
|---|---|---|
| `bullets` | markdown | the proposal, bold-lead bullets; entries attributed `(human-suggested) \| (AI-suggested) \| (agreed)` |
| `footprint` | string | affected files/areas tree for *this* solution, or the literal `"none"`; presence validated, layout instructed |
| `level` | `1..5` | this solution's ceiling |
| `recommended` | bool | true on exactly one of them |

Three rules are **mechanical**, not instructed, because each is load-bearing at
the other end: one to three entries; **sorted ascending by `level`**, always
from the lowest-level solution to the highest — the order is the identity, since
the human's pick is stored as a position; and
**exactly one `recommended`**, which is what a reviewer who touches nothing is
taken to have accepted. Ties keep the order given.

**The array is inside the content hash**, unlike every other AI proposal. A level
is self-describing and survives the AI re-proposing a different one; an index
into an AI-authored array is not, so any change to any solution resets the record
to `pending` and the reviewer picks again against what is in front of them.

**`diagnosticData` is outside the content hash** — the one narrative field that
is. It is supporting evidence the human never answers: no comment anchors
to it, no verdict is about it, and whatever actually changed the diagnosis shows
up in the narrative that states it. So a record re-filed with a fuller log keeps
its verdict, which is also what makes the upgrade free for the records decided
before the field existed. It is display-only on the review page — one collapsed
block, no comment affordance — and additive-optional in `retro.export.v1`, where
a record that carries none simply has no such key.

**Read-only historical shape.** Every record filed before this change carries
`agreedDirection` (markdown, attributed) and `footprint` (the record's one tree)
instead, with no `solutions`. Revisions are immutable and human data is never
rewritten, so both shapes are readable forever: the wire, the CLI projections,
`retro.export.v1` and the review page all carry either. **Nothing writes the old
shape again** — `revision-input.schema.ts` takes `solutions` and rejects the two
old keys as unrecognized. Narrow the write path, never the read path.

**Proposed defaults** (AI-proposed values for the human decision fields; the
human's values are what count — v2 rule):

| field | type |
|---|---|
| `severity` | 1–5 (v2 rubric; recurrence folds in, no separate field) |
| `involvement` | `autonomous \| pull-request \| interactive \| other \| undecided` (default `undecided`) |

**There is no proposed `solutionLevel` on a record that carries solutions.** The
level a record proposes is the **recommended solution's**, derived by
`proposedLevel()` and by nothing else, so the wire's `proposed.solutionLevel`,
the CLI projections and the export go on answering the same question with the
same type. A record filed before solutions has an authored one, and that is the
field `proposedLevel()` reads for it. Deriving at the readers rather than storing
a copy is deliberate: `revision get`'s `content` is promised to be a revision
file the AI can resubmit, and a stored key the input schema rejects would break
that promise.

Enum option labels follow v2's "what — why" convention wherever they surface in
UI — **solution level and involvement**. The canonical strings, imported verbatim
from v2's `ticket-schemas.md` (the single schema authority of the capture
pipeline this model carries forward):

**Severity — 1 is the highest, 5 the lowest.** Normative, and said on the label
rather than only here, so that a reader learns which end is the highest without
leaving the control. Which end is worst is convention rather than intuition, and
comparable products disagree with each other, so the scale states its own
direction. The rows are anchors, not thresholds — frequency folds into the
judgment, which is why there is no separate recurrence field.

**A severity option reads `SEVn — <short description>`.** The number leads,
because severity is the one enum a reviewer addresses by number and the
"what — why" convention buried it; the description follows it, because the
number on its own leaves a reader unable to tell one end of the scale from the
other. The option label is the **lead of the rubric row**, nothing new
written; the rows stay canonical as the **rubric** — what a severity *means*,
and what an AI proposing one is judging against:

| sev | option label | rubric |
|---|---|---|
| 1 | SEV1 — highest — halts everything | Halts everything — the tool unusable, no progress possible, the human prevented from any work; no workaround |
| 2 | SEV2 — blocks a major flow | Blocks a major flow — progress only through a costly manual workaround, the human dragged in each time it fires |
| 3 | SEV3 — degrades the work | Degrades the work — real turns, tokens or time lost whenever it is hit; a workaround exists but is paid every time |
| 4 | SEV4 — minor friction | Minor friction — an extra step, an annoyance, a cosmetic wart; cheap workaround, low cost per hit |
| 5 | SEV5 — nice-to-have | Nice-to-have — not time-critical, no workaround even needed; an improvement idea more than a problem |

**Solution level** — **strictly levels 1–5.** A ceiling, not a target; chosen
before involvement; renders as a radio list — bold level name, then its
definition:

| value | option label |
|---|---|
| `1` | Level 1 — words only: guidance text; nothing executes it, nothing conforms to it |
| `2` | Level 2 — tune existing: behavior change inside artifacts that already exist |
| `3` | Level 3 — add surface: something new that everything existing can safely ignore |
| `4` | Level 4 — change contracts: others must conform; consumers updated and old data shimmed in the same change |
| `5` | Level 5 — open-ended: emergent, autonomous, or not cleanly undoable |

**Read-only historical values.** `none`, `upstream` and `undecided` were in the
enum until it was narrowed to 1–5, and stores written before that hold them.
They can no longer be **chosen by a human or proposed by a draft** — both write
paths take the 1–5 input enum and reject them — and they are **never rewritten**,
because human data is append-only. Every read path keeps them: the wire views,
`retro.export.v1`, record history, the decisions table's own CHECK, and the
review page's read-only rendering, which shows them under the labels they were
chosen with:

| value | option label (read-only) |
|---|---|
| `none` | None — approve building nothing |
| `upstream` | Upstream — file elsewhere; nothing built here |
| `undecided` | Undecided — no level approved yet; the solving side asks |

A record still carrying one keeps it through a verdict that says nothing about
the level: the radio list simply has nothing selected until the reviewer picks
one of the five.

**Involvement:**

| value | option label |
|---|---|
| `autonomous` | No involvement — fully autonomous |
| `pull-request` | Pull request — human reviews before merge |
| `interactive` | Interactive session — human works the fix live |
| `other` | Other — the note says what |
| `undecided` | Undecided — the solving side asks first |

The explanatory half is never dropped for brevity — a two-line wrap in a
dropdown is acceptable. A UI may subset the values,
never contradict labels or meanings.

## Decision — human-only, versioned, append-only

One decision row per (retro, `rid`, version). A change appends a new version;
history is never lost. Written only by actor `human`, only via the UI;
`ForbiddenActorError` for `ai` at L3, append-only triggers at L1.

| field | type | notes |
|---|---|---|
| `state` | read: `pending \| approved \| declined \| revise \| hold` · write: `pending \| approved \| declined \| revise` | decline is a state, never a deletion; **`revise` is "rewrite this one"** — see below; `hold` is read-only history — see §Hold |
| `severity`, `involvement` | as above | initialized from the AI's proposals |
| `solutionLevel` | as above | the ceiling the human approved. On a record with solutions it is **the selected solution's level**, not a dial turned separately; on a record without them it is the dial. A stored value may be one of the read-only historical ones |
| `selectedSolution` | `int?` | which solution the verdict is for, **1-based** into the record's array — `null` on a record that proposed none. Optional on input with the same fallback as the other values, `input ?? previous ?? the recommended one`: a reviewer who accepts the recommendation says so by leaving it alone. Sending a `solutionLevel` for a record with solutions, or a `selectedSolution` for a record without, is a `ValidationError` rather than a value quietly ignored |
| `reviewerNote` | string | the human's free channel; travels verbatim into export |
| `revisionN` | int | the revision whose content this decision was made against |

**The third verdict, `revise`.** Approve, decline and revise are the three
verdicts, and each of them moves a record out of `pending`.
It is decided as far as the finish gate is concerned, and an instruction as far
as the AI is concerned: a record carrying one **must be addressed in the next
revision**, and `ReviewClosed` refuses while one stands. A revision that rewrites
the record sends it back to `pending` by the carry-over rule below, so the human
decides it again on the content that was asked for.

**Undo is an append.** Re-clicking the verdict a record already carries writes a
new `pending` version, so a second press on the same button undoes it. Nothing is
mutated and nothing is deleted: the verdict that was undone stays in the record's
history, which is the same rule every other human write obeys.

**Carry-over (carry-on-unchanged):** when revision n+1 lands, a
record whose narrative content is byte-identical (canonical-JSON hash) to the
version its latest decision was made against keeps that decision (UI shows
"decided on rev k"); any content change resets the record's effective state to
`pending` (no new row — pending is the absence of a decision for the current
content). Explicit approve only is preserved: the approval was explicit, for
identical content.

## Record lifecycle — both actors per act, versioned, append-only

**The record's second axis**, beside the verdict and never on it. Even after a
retrospective has closed, a record's life cycle has to stay manageable: metadata
can be attached to it — a commit id, a tracker issue, or any other reference —
and it can be archived and unarchived.

The **machine** — which acts exist, what each leaves the record in, who may take
which, and why declined records are born archived — is `lifecycle.md` §Record.
What follows is where the data lives.

`record_lifecycle` is a table of versions per record — `(retro_id, rid, version,
status, refs, note, actor, at)`, `UNIQUE (retro_id, rid, version)` — with the
append-only triggers, so every act is a row and nothing is ever an edit. Keyed on
the **pair**, like everything that hangs off a record.

| field | type | notes |
|---|---|---|
| `retroId`, `rid` | int, slug | the record — the pair, because a rid repeats across retrospectives |
| `version` | int | 1-based per record; the highest is the one in force |
| `status` | enum | the **act**: `resolved \| reopened \| archived \| unarchived`. CHECK widened, never narrowed |
| `refs` | JSON array | non-empty on a `resolved` row, empty on every other act; free text, trimmed |
| `note` | string? | offered, never demanded |
| `actor` | `ai \| human` | **the only `actor` column in the schema** — see below |
| `at` | timestamp | when the act was taken |

Three departures from the holds / `thread_resolutions` pattern it otherwise
copies, each earning its place:

1. **`status` is TEXT, not a bit.** Two positions were never going to be the end
   of it, and they were not: the enum went from two to four soon after. The
   widening is a **rebuild** (`20260831090000_record_lifecycle_allow_archive.ts`)
   — SQLite cannot alter a CHECK in place, which the original table header got
   wrong when it called a widening "a one-line migration". A rebuild that widens
   an enum keeps every row; unpicking a bit would have had to invent values.
2. **`refs` is a JSON array** with `json_valid`, on the `revisions.records`
   precedent — the only other column in this schema holding a list. Free text,
   because three kinds of reference were named from the start and a shape that
   knew which was which would refuse the fourth.
3. **`actor` is a column**, which no other append-only table has, because every
   other one is single-writer and the author is implied by the table. This one is
   written by the AI reporting what it fixed and by the human from the browser.
   **Per act, though**: `archived` and `unarchived` are the human's, refused for
   `ai` in the use case (`lifecycle.md` §The actor rule, per act).

**Nothing is stored for the derived state.** `open | resolved | archived` is read
off the entry in force, and — where there is none — off the verdict beside it. No
row is written at the close for a declined record, which is what keeps a store
closed before this feature answering identically to one closed after it.

**Not exported**, which is what lets this be the one write path that
survives the close: a document taken from a finished retrospective cannot change
behind its reader, because this axis is not in the document. Carrying lifecycle
into the export is on the deferred list.

Events: `RecordResolved`, `RecordReopened`, `RecordArchived`, `RecordUnarchived`
— one name per act, scoped `(sessionId, retroId, rid)` and carrying no
`revisionN`, because a record's lifecycle outlives every redraft of it.

## Labels and attributes — the two vocabularies

**Both primitives exist and each of them is pure.** A label plus a note is not
standard practice: usually labels are just labels. Supporting labels *and*
attributes lets a team build its own conventions on top of the pair — for
instance, that whenever the `migrated` label goes on, an attribute holding a
tracker issue id is set beside it. To stay flexible, no label and no attribute
is hardcoded. To stay simple, attributes keep to a few fixed types with no
further configuration, so validation stays small. And because a label or an
attribute is a global thing, defining them needs a settings page.

Five consequences, each of them a thing this model deliberately has or lacks:

1. **A label carries no payload.** `record_labels` is a definition id, a version
   and a bit. A team wanting the detail beside the classification sets an
   attribute, which is what the second primitive is for.
2. **Nothing is enforced between them.** A record can wear `migrated` with no
   value set and carry a value with no labels: composition is the **user's**
   convention, never a system mechanism.
3. **Nothing is shipped.** No migration inserts a definition, nothing defaults
   one, and `migrated` is not special in any reader. A store with labels in it is
   a store somebody typed them into.
4. **Attributes have four types and no other configuration** — `number`, `text`,
   `url`, `date` — with validation that goes exactly as far as each name promises
   (`definition-input.schema.ts`).
5. **Definitions are global**, which is what made `/settings` part of this scope.

### The definitions — the one mutable pair in this schema

| field | type | writer | notes |
|---|---|---|---|
| `id` | int | system | per vocabulary, 1-based |
| `name` | string | ai **or** human | trimmed, ≤40 chars, one line. Unique **ignoring case**, retired names included |
| `type` | `number \| text \| url \| date` | ai **or** human | attributes only; **fixed at creation and never changed** |
| `retiredAt` | timestamp? | ai **or** human | when it stopped being offered; `undefined` while it still is |
| `createdAt` | timestamp | system | |

**These two tables are the only ones in this schema that are written over**, and
the distinction is worth stating because everything around them is append-only.
A definition is *configuration* — the vocabulary human data is written in —
rather than human data itself: renaming a label is a spelling correction to a
shared list, not a second opinion about something somebody said, and versioning
it would make every reader of an applied label resolve a name as of a moment.
The append-only rule is kept exactly where it belongs, on the two application
tables below, and `retire` is what stands in for a delete: nothing is ever
removed, so a name a record was labelled with is readable forever.

**Uniqueness is case-insensitive and lives in the use cases**, not in a
collation. `COLLATE NOCASE` folds ASCII only and the memory adapter would have
had to reimplement exactly that folding to keep the contract suite honest; the
table's plain `UNIQUE (name)` stays as the L1 backstop for the exact-match case.

**There is no retype.** It would leave values behind that were accepted under a
type the definition no longer claims — retiring and redefining is the whole
alternative.

**Un-retire, on the other hand, exists.** The vocabulary's first scope was
create, rename and retire, which left retire costing one press with no confirm,
no undo, and a name the store never frees — so a mis-press burned a vocabulary
word forever.
Clearing the nullable timestamp is the whole of the write; the row, the id and
the name are untouched,
so nothing that was applied under it is disturbed either way.

### What a record wears and carries — human-only, versioned, append-only

`record_labels` is `(retro_id, rid, label_id, version, applied, at)` and
`record_attribute_values` is `(retro_id, rid, attribute_id, version, value, at)`,
both with the append-only triggers. Keyed on the **pair plus the definition**,
because a rid is minted per retrospective; and the version sequence is dense
**per definition**, so a record wearing three labels holds three independent
`version: 1` rows — which is why both repositories order `listForRecord` by `id`.

| field | notes |
|---|---|
| `applied` | `true` puts a label on, `false` takes it off. Removing is a row, never a delete |
| `value` | the text set, or **absent** where the act was clearing it — a different fact from never having carried one |

**Human-only**, whatever the AI-config-write toggle says: that
toggle governs the *definitions*, and whether the AI may ever suggest a label on
its own draft is still open. Neither table has an
`actor` column, because both are single-writer — the same rule every other
human-authored table here follows.

**Both are writable on a finished retrospective**, joining `records.setLifecycle`
and `records.relate` as the exceptions `refuseWhenFinished` deliberately does not
guard. That serves a second usage archetype, beside the lifecycle axis's: on
completion of a retrospective a team may want to move everything into their
tracker right away, putting a `migrated` label on each record as it goes —
which happens after the close by construction. None of the four endangers the lock's purpose, because none is in
the export.

**Not exported**, like the lifecycle axis and for the same reason: a document
taken from a finished retrospective cannot change behind its reader. Carrying
labels and attributes into the export is on the deferred list beside it.

Events: `LabelDefined · LabelRenamed · LabelRetired · LabelUnretired ·
AttributeDefined · AttributeRenamed · AttributeRetired · AttributeUnretired`
are **globally scoped** — no session, no
retrospective — because a definition belongs to none; `RecordLabelApplied ·
RecordLabelRemoved · RecordAttributeSet · RecordAttributeCleared` are scoped
`(sessionId, retroId, rid)` and carry no `revisionN`, because a label outlives
every redraft of the record it is on.

## Record relations — both actors, versioned, append-only

Both actors can relate records, each relation carries how-they-relate words, and
a relation reads from both sides, so that the AI can find past records and build
holistic solutions.

`record_relations` is `(from_id, to_id, version, applied, how, actor, at)` with
`UNIQUE (from_id, to_id, version)`, `CHECK (from_id != to_id)` and the append-only
triggers. **Both sides are `record_ids.id`**, and that is the only shape
available: every other per-record table addresses one record as the pair
`(retro_id, rid)`, and a key made of two pairs is a key nobody can read, join on
or say out loud. The global id exists for exactly that reason, and it costs a
cross-retrospective relation nothing — which it must, because finding past
records means past retrospectives.

| field | notes |
|---|---|
| `how` | the words, **required on every row**. Free text, no vocabulary: the `refs` argument, that a shape insisting on knowing which kind it is refuses the fourth kind |
| `applied` | `true` relates, `false` takes it off. Un-relating is a row, never a delete — and the row carries **forward** the words of the relation it takes off, so the history never holds two accounts of one relation |
| `actor` | `ai` or `human`. The second table in this schema with one, and for `record_lifecycle`'s reason: every other append-only table is single-writer, and this one is not |

**Directed as authored, read from both sides, never mirrored.** One row per
relation; reading from both sides is a property of the read
(`listForRecord` asks `from_id = ? OR to_id = ?`, hence one index per side) and
the direction is what differs between the two answers. A mirror row would be a
second thing to keep in agreement, a second thing to un-relate, and a second
version sequence to number.

**The reverse pair is a different row and is allowed.** `(#5, #12)` and
`(#12, #5)` carry two sequences because they are two statements; refusing the
second would decide that relations are symmetric when the words on them are what
say whether they are. Versions are dense **per ordered pair**, so a record holding
four relations holds four independent `version: 1` rows — which is why the
repository orders `listForRecord` by `id`.

**A bit rather than a status word**, which is the fork `record_labels` and
`record_lifecycle` chose opposite ways on. The bit is right here for the labels'
reason: relating and un-relating are on and off, and there is no third position a
relation could occupy — a relation that means something else is different *words*
or a different pair. Nothing here is a scale.

**Both actors, on both acts.** Unlike the lifecycle, there is no per-act
exception: both acts belong to both actors. The AI writes in its own process
through `retro record relate`; the human writes from
the browser through `records.relate`, whose context actor is `human`
unconditionally.

**Writable on a finished retrospective** — the fourth and most
closed-retro-shaped exception `refuseWhenFinished` does not guard, since the far
end is normally in a retrospective that closed sessions ago. **Not exported**,
for the reason that keeps the exception defensible: a relation *can* be authored
after a document was taken, so putting it in the export would trade *"a document
cannot change behind its reader"* for a key.

Events: `RecordRelated · RecordUnrelated`, scoped `(sessionId, retroId, rid)` of
the record the act was taken **from**, carrying both global ids in the payload —
one scope for a row that names two records, because `EventScope` addresses one
retrospective and a relation is the one thing here that crosses them. No
`revisionN`, because a relation outlives every redraft of either record.

## Record claims — the in-progress marker, versioned, append-only

`record_claims` is `(retro_id, rid, version, claimed, actor, at)` with
`UNIQUE (retro_id, rid, version)`, one index on `(retro_id, rid, version)` and the
append-only triggers. It answers one question: **is somebody working on this
record right now?**

It exists for the solving side. `retroloop record queue` is every approved,
unresolved record of every finished retrospective, and two agents reading that queue a
minute apart must not both pick up the same record — so the first one writes a
claim and the second is refused with a conflict.

| field | notes |
|---|---|
| `claimed` | `true` takes the record, `false` gives it back. A bit rather than a status word, on `record_labels`' argument: held and not-held are on and off, and no third position exists for a marker to occupy |
| `actor` | `ai` or `human`. The **third** table in this schema with one, for `record_lifecycle`'s reason: whoever does the work holds the record, and that is the AI most of the time and the human sometimes |
| `at` | when the row was written — the `claimedAt` every read model shows |

**Addressed `(retro_id, rid)`**, which is the address every per-record table here
takes. That is the departure from `record_relations`, and the reason for it is the
same one: a relation names two records and is keyed on global ids, and a claim
names one.

**It is a marker beside the lifecycle axis, never a fourth position on it.** The
cheaper move was a fifth `record_lifecycle.status` word, and it is refused because
that axis answers "did we do it" and every value on it is a settled fact
somebody reported, with references where a claim is being made. "Being worked on"
is not settled and reports nothing: it is true for an afternoon and then it is
not, and a claimed record is still `open` in every sense the lifecycle means. So
`RecordLifecycleStatus`, `EffectiveLifecycle`, `LIFECYCLE_ACT_FROM`, the CHECK on
`record_lifecycle.status`, the wire lifecycle shape and the export are all
untouched by this table.

**Append-only, and releasing is a row.** "Claimed at 10:00, released at 11:40,
claimed again at 14:00" is what somebody asks for when they want to know why a
record sat still for a day, and the version sequence is what the next claim
numbers itself after — releasing by deleting would make the next claim version 1
again and throw the history away. A **released** claim is still the entry in
force; `effectiveClaim` reads it as nobody holding the record, which is the same
answer a record nobody ever touched gives.

**A resolve clears the claim**, in the same unit of work and by the same actor
(`set-record-lifecycle.use-case.ts`) — the one place outside `records.claim` that
writes this table. The work the claim was about has finished, so a marker left
standing would make every resolved record read as still being worked on. It is
not an inference from silence: nothing reads a commit, a close or the passage of
time, and the row it writes carries the resolver's name. **Only the resolve** —
a reopen does not hand the record back to whoever had it, and an archive says
nothing about who was working on it.

**What it is not.** It is not a lock (nothing enforces it below the use case), not
a lease (it does not expire — a stale claim is released by somebody, which is why
`unclaim` exists), not an assignment (nobody is given a record; somebody takes
one), and not exported: a document taken from a finished retrospective still
cannot change behind its reader, which is what keeps this write's exemption from
the finish lock defensible alongside the four that came before it.

Events: `RecordClaimed · RecordUnclaimed`, scoped `(sessionId, retroId, rid)`,
carrying `{ version, actor }`. No `revisionN`, because a claim outlives every
redraft of the record it is on. `RecordUnclaimed` is also what a clearing resolve
appends, immediately after `RecordResolved`.

## Settings — the AI-config-write toggle

The config page carries a toggle the user can enable to give the AI the ability
to update the configs. While it is disabled, the user can be certain the AI
cannot change them.

`settings` is a table of versions per key — `(key, version, value, at)`,
`UNIQUE (key, version)` — with the append-only triggers. One key today:
`ai_config_write`, `'on'` or `'off'`.

Four properties, and every one of them serves that certainty rather than a
preference:

1. **Off is the default and no row says so.** Nothing is inserted at install, and
   `undefined` reads as off — so the safe state is the state a store is born in.
2. **A table of versions, not a column.** Certainty is a claim about the past as
   well as the present, and a column would have thrown the history away on the
   first change. This is the one table in this schema where the history *is* the
   feature; re-asserting the value still writes a row.
3. **Enforced in core, at the store boundary, inside the unit of work that would
   do the writing** (`config-write.service.ts`) — not in the settings page, not
   in a tRPC middleware, not in the CLI's argument parsing, all three of which
   the AI's own process walks past. Reading it inside the same `tx` also closes
   the window where the human turns it off while a write is in flight.
4. **The toggle itself is human-only forever**, whatever it currently says. A
   permission switch its own subject can flip is not one, so the AI is refused
   here even while the switch is *on*, and there is no CLI command for it at all.

The refusal is `AiConfigWriteDisabledError`, carrying the `FORBIDDEN_ACTOR` code
so it arrives as FORBIDDEN over tRPC and exit 5 on the CLI without either map
growing a branch. Its message names the setting rather than claiming the act is
the human's — with the switch on it is not.

It governs the **definitions only**. Applying a label and setting a value stay
human-only whatever it says.

## Hold — removed

**Hold is not a feature of this product.** It was one briefly, and it was
removed on first contact with the built thing: the control read *Hold* and asked
for a reason, and clicking it turned the same control into *Release* — so a
reader could not tell whether the record was on hold before the click or after
it.

**The need routes through involvement.** "Do not do this without me" is what
`involvement: interactive | pull-request` already says, on the decision, where
the human is already choosing. A second construct restating it was machinery the
model did not need.

**What went, and what stayed.**

| gone (the living surface) | stayed (the record) |
|---|---|
| the hold control and the HELD tag on the review page | the `holds` table |
| `holds.set` / `holds.clear` on the tRPC router | its migration, `20260825120000_create_holds` |
| the `SetHold` / `ClearHold` use cases and `holdInputSchema` | its append-only triggers |
| `hold` on `RecordView`, `held` on the record summary and on `RecordVerdict` | `Hold` / `NewHold`, `HoldRepository`, both adapters, the repository contract suite |
| `held` / `holdNote` in the export **document** | `held` / `holdNote` in `export.v1.schema.json`, optional and read-only |
| `counts.held` on `review status`, `[held]` in `record list` | any rows a store already carries |

Human data is append-only and is never deleted: a store that already holds hold
rows still holds them. What changed is that nothing writes another and
no read path surfaces one.

**Two consequences worth stating.**

- **The exception these two carried moved rather than vanished.** `holds.set` and
  `holds.clear` were the only two writes a finished retrospective took, because
  the solving side read a hold long after the review closed. With them gone
  `refuseWhenFinished` governed every human write without qualification for a
  time — and then the record lifecycle axis reopened the same
  position for a better reason: §Record lifecycle is now the one write a finished
  retrospective takes, and it is safe where a hold was not because it is not
  exported (`finish-lock.service.ts`, `lifecycle.md`).
- **`export.v1` keeps `held` and `holdNote` as optional properties.** The
  builder stops emitting them; the schema goes on admitting them. Removing a
  property from a versioned public contract whose record object is
  `additionalProperties: false` would invalidate every document written while the
  feature existed — the same reason the schema still admits a `hold` verdict and
  the solution levels the 1–5 narrowing cut. Narrow the write path, never the
  read path.

**Read-only historical `hold` verdicts.** Separately from all of the above,
`hold` was a `DecisionState` until it left the verdict enum, and every read path
keeps admitting one: the wire views, `retro.export.v1`, record history, the
decisions table's own CHECK, and `record list --state hold`. Nothing may write one
— `decisionVerdictSchema` is the four-value input enum (`pending`, `approved`,
`declined`, `revise`; it was three until `revise` was added),
and the narrowing is at
the write path exactly as the solution-level narrowing did it. That verdict is a
value a human once chose and is unaffected by the removal above.

## Comment threads

Anchored to a record section or review-level. Sections:
`title | problem | human_words | root_cause | workaround | direction | footprint | solutions | defaults`.

`solutions` is **one anchor for the whole block**, not one per solution: a
comment about the second proposal names it in prose, and an enum grown per array
element is an enum migrated every time the array can hold one more.
`direction` and `footprint` stay in the vocabulary forever — stores written
before solutions carry threads on both, the export requires a component for
every thread, and a
value removed here would make documents already written unrepresentable. Nothing
anchors a *new* thread to either, because a record with solutions has no such
section.
Review-level threads have no `rid`. Messages append-only, `actor` = `ai | human`;
the CLI writes only `ai` replies; human comments are UI-only and immutable.

**A comment carries the revision it was written against; a thread does not.** A
comment states the revision number it is associated with, while still showing
across every revision. `comments.revision_n` is captured at write time — the
browser sends the revision it is showing, because a revision is announced and
never swapped in, and the CLI sends none and is stamped with the
latest. The column is nullable and every row written before it stays NULL
forever: human data is never rewritten. Read views emit an always-present
`revision` per message instead, deriving one for those rows as *the latest
revision filed at or before the comment* — which says which revision was current,
not which one the writer was reading. The derivation is in
`application/views/thread.view.ts` and nowhere else, so the CLI and the browser
cannot answer it differently. The **thread** stays keyed on
`(retroId, rid, section)` and shows on every revision, exactly as before.

**Threads are resolvable, and only the human may resolve one** — the AI never
marks a thread resolved, and a resolved thread appears collapsed.
`thread_resolutions` is a
table of versions per thread — `(thread_id, version, resolved, at)` — with the
append-only triggers, so reopening is a new row and never an edit, the way a
decision and a hold are. The effective value is the highest version's, `false`
when nobody has marked it. `threads.resolve` is the one procedure that writes it;
`ResolveThreadUseCase` refuses the `ai` actor before it looks at anything else,
and there is no CLI flag that reaches it. Resolution carries no revision,
deliberately: a thread outlives every redraft of the record it hangs off, so "I
have dealt with this" does not stop being true because a paragraph was rewritten.

## Finish message — human-only, versioned, append-only

**The round has a field of its own, and it is the human's.** Finish is two
steps: when the round is valid and can be closed, a text box takes the human's
final message before the close, and that message is delivered separately from
the comments.

`finish_messages` is a table of versions per round — `(retro_id, revision_n,
version, message, at)` — with the append-only triggers, so an amendment would be
a new row and never an edit, the way a decision and a thread resolution are.
Exactly one version exists today, because the finish is once per round and an
absorbed second press writes nothing at all: the message rides the press that
carried it.

| field | type | notes |
|---|---|---|
| `retroId`, `revisionN` | int | the round it closes — the same key `ReviewFinished` carries |
| `version` | int | 1-based per round; the highest is the one in force |
| `message` | string | never empty: a blank box writes no row, because an empty box is not a message and nothing is inferred from silence. Stored trimmed |
| `at` | timestamp | the moment of the finish it rode |

**Why a table and not a column, a comment, or a note.** Nothing owned "the round"
before this — a round was a `ReviewFinished` *event* keyed `(retroId, revisionN)`
and no row anywhere, and `events.data` is the outbox's audit trail rather than a
read model. A comment is wrong for a different reason: comments are threads the
AI answers, and this is a verdict-adjacent summary of the round with a different
lifecycle and a different reader posture — it is delivered separately from the
comments. A note is wrong for a third: the AI is blind to human
notes until drafting, and this must reach it at the moment the round
closes.

**Who writes it and who reads it.** `review.finish` is the one procedure that
writes it, `FinishReviewUseCase` refuses the `ai` actor before it looks at
anything else, and there is no CLI flag that reaches it. It is written in the
same unit of work as `ReviewFinished`, so the word exists if and only if the
round it closes does. The AI reads it on the round read —
`revision get --feedback-only` carries `finishMessage` for the revision asked
about — and the export carries every round's, as
`retrospective.finishMessages[]`, ascending by revision. No thread machinery
touches it anywhere.

## Notes, annotations, requests

- **Note (ai):** `note add`, append-only, `kind: human-cost | ai-cost` (seeds the
  record's `impacts` default). Streamed live to the session page.
- **Note (human):** UI-only, append-only, versioned per revision, invisible to the
  AI except at drafting time (`note list --with-human`).
- **Annotation:** human's one-shot remark on one AI note; no threads; same
  drafting-time visibility.
- **Request:** *removed as a living feature*. It was a top-level human ask on a
  review, opened and closed by the human and answered by the AI; the panel, the
  `requests.*` procedures, the `retro request` commands, the use cases and
  `revision get`'s `requests` key are all gone, and a **review-level comment
  thread is the one ask channel** — one ask per review-level comment, which is
  everything the removed construct offered. The
  `requests` and `request_responses` tables, their migrations, their triggers and
  any rows **stay**, unread, the way the `holds` table does: human data is
  append-only and is never deleted. No store has ever carried a request row.

## Events (outbox)

Appended in the same unit of work as the write they describe; the tailer and
`review wait` consume them. Minimum set for Tier 1:

`SessionCreated · NoteAdded · AnnotationAdded · RetrospectiveStarted ·
RevisionCreated · DecisionRecorded · HoldSet · HoldCleared · CommentAdded ·
ThreadResolved · ThreadReopened · RecordResolved · RecordReopened ·
RecordArchived · RecordUnarchived · LabelDefined · LabelRenamed · LabelRetired ·
LabelUnretired · AttributeDefined · AttributeRenamed · AttributeRetired ·
AttributeUnretired · AiConfigWriteEnabled ·
AiConfigWriteDisabled · RecordLabelApplied · RecordLabelRemoved ·
RecordAttributeSet · RecordAttributeCleared · RequestOpened · RequestResponded ·
RequestClosed · ChangesRequested · ReviewFinished · ReviewClosed`

The eight names with **no scope at all** — the six definition acts and
the two toggle acts — are the first events in this outbox addressed to nothing.
A definition and a setting are global, so `events.onRetro` delivers none of them
to any page; they are written because the outbox is this store's audit trail,
and the certainty that the AI changed no configuration unseen is a claim those
rows are the evidence for.

The four `Record*` names are one per lifecycle act (`lifecycle.md` §Record), so a
consumer watching for "somebody put this out of the way" reads the name rather
than unpacking a payload — and the two `Thread*` names are the same idea one
table over.

`HoldSet`, `HoldCleared`, the three `Request*` names and now `ChangesRequested`
are **frozen**: nothing appends one since hold, requests and the second review
button were removed, and they stay in the set because a store written
before those removals holds rows carrying them and every reader — the tailer,
`review wait`, the subscription — must go on parsing one rather than choking on
it. The same rule the read-only decision states obey.

`review wait` terminates on **`ReviewFinished`** for its retro and prints
`{ kind, retroId, revision, at }`. One name, because the
human presses one button, and what the round was about is read from the round.
A `ChangesRequested` row in an old store no longer unblocks a wait, which cannot
matter — the wait starts from the latest `RevisionCreated`, and such a row is
always older than that.

## Mutability matrix

| data | writer | mutability |
|---|---|---|
| session identity | ai (create) | write-once |
| ai notes | ai | append-only |
| revisions + all narrative | ai | immutable once created |
| ai thread replies | ai | append-only |
| decisions (state, severity, level, involvement, note) | human, UI-only | append-only versions |
| record ids (the global number) | ai (minted by the store on first appearance) | insert-once, never moved |
| record lifecycle: resolve / reopen | ai **or** human | append-only versions |
| record lifecycle: archive / unarchive | human | append-only versions |
| label and attribute definitions | ai (while `ai_config_write` is on) **or** human | **mutable** — configuration, not human data; retired rather than deleted |
| labels on a record, attribute values | human, UI-only | append-only versions |
| relations between two records (relate / un-relate) | ai **or** human | append-only versions |
| the in-progress marker on a record (claim / release) | ai **or** human | append-only versions |
| the `ai_config_write` setting | human, UI-only | append-only versions |
| holds (held, note) | nobody, since hold was removed | existing rows are append-only history; no read path |
| finish message (the round's final word) | human, UI-only | append-only versions |
| human comments, notes, annotations | human, UI-only | append-only |
| requests | nobody, since requests were removed | existing rows are append-only history; no read path |

The human never edits narrative — corrections travel as comments and come
back as revision n+1 authored by the AI. The AI never writes any human field —
enforced at L3 (use cases) and backstopped at L1 (triggers).

## Dropped from v2

- `reviewed: human | none` — every finished Retro review passed through the UI by
  construction; the export states it as a constant.
- v1 `pain`, v2 `solution-kind` — superseded upstream; never existed here.
