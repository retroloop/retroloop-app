# tRPC surface

> **Derived** from `data-model.md`, `ui.md`, `realtime.md`, and the merged core
> use cases. The procedure set is deliberately the
> **minimum the review page v0 + the e2e loop need** — every procedure earns its
> place, because the typed mock and the procedure-set meta-test mirror this
> router key-for-key (R-MOCK-LOCK).

## Principles

- **The browser is the only client, and it is always the human.** The CLI runs
  the App in-process and never talks to the server (architecture.md). The tRPC
  context therefore carries `actor: 'human'` unconditionally — there is no auth,
  no actor negotiation, nothing to spoof: AI writes cannot arrive here at all,
  and core's L3 guards still hold if something tries.
- **Routers declare `.input()` AND `.output()`** with zod schemas from
  `@retro/core` — the wire contract is checked both ways. One exception: the
  subscription has no `.output()` — tRPC v11 validates a
  subscription's yield as the `tracked()` envelope, not the payload, so an
  output schema rejects every event; the payload is typed via a zod-inferred
  wire mapper instead.
- **Context type/value split** (`context.ts` type-only, `context.factory.ts`
  value) so `web → api` stays a type-only import.
- **v11 fetch adapter on `Bun.serve`;** the server also serves the `apps/web`
  build (`static.ts`).

## Error map (`errors.ts`)

| domain error | TRPCError code |
|---|---|
| `NotFoundError` | `NOT_FOUND` |
| `ConflictError` | `CONFLICT` |
| `ForbiddenActorError` | `FORBIDDEN` |
| `ValidationError` | `BAD_REQUEST` |
| `FinishGateError` | `PRECONDITION_FAILED` (payload: pending rids) |
| anything else | `INTERNAL_SERVER_ERROR`, message scrubbed |

## Procedures — v0

Namespaces mirror the core's use-case groups. Inputs/outputs are the core's
views; ids are integers, `rid` is the record slug.

| procedure | kind | serves |
|---|---|---|
| `retros.get({retroId})` | query | breadcrumb + retro state (the **displayed** reading: `open`/`reviewing`/`submitted`/`finished`, where `submitted` is derived and never stored — `lifecycle.md` §submitted) + revision list meta (`?rev=k` pinning) + `title` (latest revision's, nullable — N3) + `project` nullable (N2) + `session {id, cwd, startedAt}` (N1 — replaced the bare `sessionId`; input is `strictObject`, so callers pass `{retroId}` exactly; `retros.list` likewise demands a literal `{}`) |
| `retros.list({})` | query | the dashboard's flat list (N4): every retro newest first, ordinal #n within its session, title (nullable), state (the same displayed reading `retros.get` gives, from the one events read this list was widened to make), pending/decided counts, session `{id, cwd, startedAt}` |
| `records.list({retroId, revision?})` | query | the records column, effective states incl. D2 carry-over, pending count |
| `records.get({retroId, rid, revision?})` | query | one record: narrative, proposals, decision, threads (realtime refetch target) |
| `records.listAll({})` | query | the flat cross-retro records page: every record of every retrospective in one list, each row carrying its own retro and session identity. No arguments — `strictObject({})` rejects any, because the filters are the page's and a filter parameter would decide ahead of the evidence which ones matter (A4) |
| `records.byId({id})` | query | one record by the global number a human reads off the page (`/records/:id`): latest revision only, plus the identity line, the lifecycle, its **relations** (both directions, each naming the other record) and the timeline. The one record read that runs the global sequence backwards — every other addresses a record as `(retroId, rid)`, which is right (A5) and is not something anybody types or bookmarks |
| `records.setLifecycle({retroId, rid, status, refs?, note?})` | mutation | resolve / reopen / archive / unarchive a record after the review that settled its verdict has closed. One procedure carrying the act rather than one per position; `refs` and `note` are transport-optional and the domain decides which pairings are legal, from which state, and by whom |
| `records.relate({fromId, toId, related, how?})` | mutation | two records said to belong together, in the words of whoever relates them — or the relation taken off. Both actors can relate records, each relation carries how-they-relate words, and the relation reads from both sides, so that the AI can find past records and build holistic solutions. **The one write here addressed by global ids**, because a relation names two records and `(retroId, rid)` is the address of one — and because it deliberately crosses retrospectives. One procedure carrying both acts with a boolean rather than a status word, on `records.setLifecycle`'s standing and `labels.set`'s reason: relating and un-relating are on and off. `how` is transport-optional and the domain decides the pairing — required on a relate, refused on an un-relate, whose row carries forward the words of the relation it takes off |
| `decisions.record({retroId, rid, revision, state, severity, solutionLevel, involvement, reviewerNote?})` | mutation | approve / decline / revise / back-to-pending + defaults + note (D1/D4); `solutionLevel` input is strictly 1–5, and `state` is the four write values (legacy `hold` remains read-only on output shapes) |
| `threads.reply({threadId, text})` | mutation | reply in an existing thread |
| `threads.open({retroId, target, text})` | mutation | open a section/review-level thread (data-model §threads) |
| `threads.list({retroId})` | query | **every** thread of the retrospective, record-level and review-level alike. It was review-level only at first and was then widened, so that inline comments in the retro body give way to comments in the side panel and the human sees every comment in one place — so `records.get` stopped carrying a record's threads and this became the one wire source for any of them. |
| `threads.resolve({threadId, resolved})` | mutation | the human marking a thread dealt with, or reopening one. One procedure with a boolean rather than a resolve/reopen pair; a write nothing else expresses, since a comment is not a verdict on the conversation and resolution is set rather than inferred |
| `review.finish({retroId})` | mutation | ReviewFinished — the human's one terminal action; surfaces `PRECONDITION_FAILED` with pending rids, and absorbs a second press of the same round |
| `events.onRetro({retroId, lastEventId?})` | subscription | the one SSE stream; `tracked()` ids; `Last-Event-ID` replay (realtime.md) |
| `labels.list({})` | query | the whole label vocabulary, retired entries included, in minting order. One read rather than an offerable/retired pair: the settings page greys the retired ones, a record page resolves a name for one that may since have been retired, and the filter offers one as long as a record still wears it — three readers, three subsets, one answer |
| `labels.define({name})` | mutation | create a label. Gated for the AI by `ai_config_write` **in core**, not here |
| `labels.rename({id, name})` | mutation | rename one; every record wearing it reads the new name at once, because a definition is written over rather than versioned. By `id` because a browser holds the list it just read and an id survives a rename |
| `labels.retire({id})` | mutation | stop offering it. Never a delete — the records that wear it keep it, and the name stays taken |
| `labels.unretire({id})` | mutation | offer it again. The same row, same id, nothing else changed; the name was never freed, so it cannot collide. CONFLICT on one that is not retired, mirroring a second retire |
| `labels.set({retroId, rid, labelId, applied})` | mutation | the human putting a label on a record or taking it off. **`set` and not `apply`**: `@trpc/server`'s `reservedWords` are `["then", "call", "apply"]` and a router key of `apply` throws at *runtime*, after typechecking clean. The App's use case is still `labels.apply`. Human-only in the domain whatever the toggle says, and reachable on a **finished** retrospective — the migrate story happens after the close |
| `attributes.list({})` | query | the attribute vocabulary, same shape and same reasoning, plus each definition's type |
| `attributes.define({name, type})` | mutation | create one with its type, fixed from then on: there is **no retype** anywhere, because every value already stored was accepted under it |
| `attributes.rename({id, name})` | mutation | rename one; the input carries no type, which is what makes a retype unreachable rather than merely absent |
| `attributes.retire({id})` | mutation | stop offering it; the values already carried keep rendering |
| `attributes.unretire({id})` | mutation | offer it again, **still of the type it was created with** — which is what makes an un-retire safe where a retype would not be |
| `attributes.set({retroId, rid, attributeId, value?})` | mutation | set a value on a record, or **clear it by omitting `value`** — the one input on this wire whose absence is an act rather than silence. Validated against the definition's type, lightly, in the domain |
| `settings.get({})` | query | the global settings — one key, `aiConfigWrite`, as a named boolean. Open to both actors: reading a permission is not exercising it |
| `settings.setAiConfigWrite({enabled})` | mutation | the AI-config-write switch. Human-only in the domain **forever**, whatever it currently says — a permission switch its own subject can flip is not one. `enabled` is required and has no default: nothing here is granted by omission |

Everything else the UI reads on the review page rides on these — `review.status`
is derivable client-side from `records.list`; it does not get a procedure until
a page needs it that cannot afford the list.

**The fourteen vocabulary and settings procedures are three namespaces rather
than fewer**, and that is a design rule made structural: labels and attributes
are pure and independent primitives, and composing them is the user's own
convention, never a system mechanism — a single `definitions.*` would be the
first place a reader looked for the pairing the system does not have. `settings.*` is the third
because a global switch has no retrospective to hang off.

**What is deliberately not among them**, on the every-procedure-is-a-thing-to-mock
rule: no `retype`, and no per-record read of either primitive — a record's labels
ride on `records.get`, `records.byId` and `records.listAll`, and its values on
`records.byId` alone, all of which the pages are already holding. **`unretire`
was on this list** and came off it by the only route this list
recognises: a retrospective asked for it, because one-press-irreversible was
burning words out of a vocabulary that never frees a name.

**There is no `review.requestChanges`, and no `review.close`.**
`requestChanges` was the second half of a pair that put
one judgment to the human twice, and it was removed: what a round asks for
should be clear from the content of the comments rather than from a redundant
button that is easy to press wrong. Its use case went with it and
the `ChangesRequested` event name is frozen, readable, unwritten.

Closing a review to export is the *AI's* act and lives in the CLI
(`retro review close`), so it has no procedure at all. That is not an oversight
to be corrected later: this context is unconditionally `actor: 'human'`, and
`CloseReviewUseCase` refuses that actor — a procedure added here could only ever
return `FORBIDDEN`.

**There are no `holds.*` procedures either.**
`holds.set/clear` shipped once and the hold experience was removed altogether:
the same thing is achieved by marking a record as one to be done only with the
human in the loop. That is
`involvement`, which `decisions.record` already writes. The `holds` table keeps
its rows; no procedure reads or writes one, and `records.list` / `records.get`
no longer carry a `held` field.

**There are no `requests.*` procedures, and there will not be again.**
`requests.list/open/close` shipped once and were removed: comments at the review
level carry the same thing, one individual request per comment.
Review-level comment threads are the one ask channel. The `requests` table and
its rows stay in the store the way the `holds` table does — no procedure and no
use case reads or writes one.

## Deferred procedures (added with their pages, never before)

**Iteration 2:** ~~`retros.list`~~ **shipped (N4)** —
~~`threads.list`~~ **shipped**: review-level
threads had a write path and no read path at all, which is most of why
review-level asks went in under a record. Both are in the v0 table above.
`requests.open/close/list` and `holds.set/clear` shipped alongside `threads.list`
and were **removed again** — see §Procedures.

Session pages later add `sessions.list`,
`sessions.get`. Also later: `notes.addHuman`, `notes.annotate`,
`records.history`. No `projects.*` procedures — ever, until the project
construct emerges organically. Each procedure lands together with its
UI and its mock coverage in the same change, keeping the meta-test green.

## Reserved names — `then`, `call`, `apply`

**Three procedure names are legal TypeScript and illegal tRPC, and they fail
only when the router is built.**
`createRouterFactory` refuses them outright — the list is
`["then", "call", "apply"]`, read verbatim out of `@trpc/server@11.18.0`'s own
`reservedWords` (`apps/api/node_modules/@trpc/server/dist/tracked-DWInO6EQ.mjs:179-183`)
— because a router is a callable-ish object and those three collide with
`Function.prototype` and with thenable detection.

**Nothing in the type system says so.** The labels work named a mutation after
its domain verb and `apply` typechecked clean in all four packages; the first
refusal came from the composed router at runtime. Measured against 11.18.0:

```
t.router({ apply: t.procedure.query(() => 1) })
→ Error: Reserved words used in `router({})` call: apply
```

**The shipped answer is a naming split, and it is the precedent to copy.** The
wire procedure is `labels.set`; the App keeps the domain's `labels.apply`,
because the App is a plain object, `apply`/`remove` is the domain's verb, and
the events are `RecordLabelApplied`/`RecordLabelRemoved`. The name differs in
exactly one place (`apps/api/src/trpc/routers/labels.router.ts`). `set` also
makes the pair symmetric with `attributes.set`.

**The tripwire is `scripts/check-mock-parity.ts`, and it works from both
sides.** It refuses any enumerated procedure path whose segments include a
reserved word (`reservedNameFindings`) — and because a reserved name means the
router never builds and therefore enumerates nothing, it loads the router
through a guarded dynamic import and translates that construction failure into
the same named refusal (`routerBuildFinding`). Either way the gate goes red
naming the class and this section, instead of dying as an unattributed crash
out of `node_modules`.

## URL params — `validateSearch` narrows, it does not police

**Not a tRPC procedure, and it is written here because it is the same class of
mistake as trusting a wire input.**
TanStack Router's `validateSearch` gives a route's search params their TYPE. It
does **not** reject values at runtime: a validator that omits an unrecognised
key still leaves `Route.useSearch()` answering the raw search.

Measured on two independently written surfaces:

```
/settings?tab=nonsense   → validateSearch runs (3×), returns {} …
                           useSearch() answers {"tab":"nonsense"}
/records?lifecycle=nonsense → validateSearch returns {} …
                           the filter seeds on "nonsense": 0 of 132 records shown,
                           no chip pressed
```

**So every search value is checked where it is used**, never only where it is
declared. The shipped guards are `records-filter.tsx` §`seeded` (an unknown
lifecycle is no lifecycle), `retros.$retroId.tsx` §`pinnedRevision` /
§`anchoredRecord` (a `?rev=` that is not a positive integer is not a pin), and
the reference fix the class was found by
(`openTab` matching the three known names). The `/settings` rebuild carries no
search params at all, which is the other way to be safe.

The distinction to keep: the validator is the **type**, the point-of-use guard is
the **check**, and a comment claiming the router drops what the validator omits
is wrong on this router.

## Subscription mechanics

Per `realtime.md`: tailer (`data_version` poll ~300 ms, persisted cursor) feeds
in-process listeners; `events.onRetro` filters by the retro's session, replays
`events WHERE id > lastEventId` from the table before joining live, then yields
tracked events. Queries stay request/response; `apps/web/src/lib/live.ts` owns
the single event→invalidation mapping (announce-don't-swap for
`RevisionCreated`).

## Enforcement hooks (already in place)

- Biome bans `@trpc/server` value imports in `apps/web`; `check-deps.ts` allows
  `web → api` as type-only.
- The procedure-set meta-test asserts the mock module's key set
  equals this router's — no more, no fewer.
