# UI design — review page (v0) and the rest

> **Drafted assumed, reviewed since.** Written session 2 while the owner was
> away, under his "safe assumptions, captured in git" authorization; the review
> rounds have overwritten most of the assumptions with his own words, and every
> row below that carries a quotation is one of them. The dashboard is locked by
> the `harbor` mock; this file covers what harbor does not: the review page
> (BACKLOG item 6, the only fully-built route in Tier 1) and the stubs.
> Route contract per the ux brief (private project records); data
> shapes per `docs/design/data-model.md`; styling language copied from the
> `harbor` worktree, never merged.

**Governing rule (KC-0014): every element earns its place.** Each element below
names the requirement that pays for it. Anything not listed is deliberately
absent — a retro can add it back.

## Review page — `/retros/:retroId` (v0, BACKLOG item 6)

`?rev=k` pins an older revision (read-only). Default view = latest revision.

### Page measure — one, everywhere

**Every route takes the same measure: `max-w-5xl`, and `wide:max-w-[96rem]` on a
screen with room for three columns.** The owner asked for it in session 7 —
*"The width of the home page is not consistent with the width of the retro
page"* — and it replaced an `AppShell wide` prop the review page passed exactly
while its comment rail was mounted, which made a page's width a function of a
query's answer.

`wide` is `--breakpoint-wide: 92rem` (1472px, `styles.css`) and it is the only
width this page's geometry turns on: the measure widens there, the reading column
takes its cap there, and the two rails mount there. 1536px is what the three
columns and their gutters come to — 24 + 288 + 32 + 768 + 32 + 368 + 24 — so the
last column ends where the header's last control does rather than short of
it, and past 1536 the page centres instead of growing (session 9: *"if the screen
is very wide it shouldn't go all the way to the sides"*).

**Round two of the same dial, and every pixel of it went to the rails** (retro 10
`r-wider-page-for-panels`, the owner: *"I think the max width should be even wider
and all of it should go to the left index panel and the right comments panel"*).
The measure stepped 88rem → 96rem, the reading column's cap did **not** move, and
the 128px went 48 to the index (240 → 288) and 80 to the comments (288 → 368),
weighted to the side where threads wrap hardest.

The breakpoint moved with them because it is not a taste value: it is the rails
plus the gutters plus the reading column's ~700px floor — 24 + 288 + 32 + 704 +
32 + 368 + 24 = 1472 — so widening the rails by 128px moves the breakpoint by
128px too. **The consequence is that no canonical viewport shows three columns any
more**: a 1440 laptop and a 1366 landscape iPad both had them at 84rem and both
now read the review in the narrow layout, one column with the panels behind their
glyphs. That is a direct trade against the rail widths — at the 704px floor the
three columns fit 1366 only while the two rails total ≤ 550px, and they now total
656 — and it is flagged for the owner rather than settled here.

The reason that prop existed still holds and is handled one level in: the extra
`wide` room is the side columns' and a `flex-1` reading column with no cap takes
it the moment a rail is absent (992px of prose, measured in a UI review). So
**the reading column caps itself** at `wide:max-w-[48rem]` — 704px at the
breakpoint itself, 768px once the page has stopped widening, starting at the same
x whether or not a rail is beside it, which is what stops a rail's arrival
shoving the prose sideways. Below `wide` there is no side column to reserve and
no cap.

### Page chrome

| element | pays for it |
|---|---|
| Breadcrumb `Project › Session › Retro #n · Rev k` (project crumb only when the session has one — N2) | route contract (ux-brief 03) |
| Theme toggle (dark/light/system, persisted) | route contract (ux-brief 03) |
| Review header: the retro's name (title or the #120 fallback) + identity line `Retro #n · Session S · cwd` + the retro's state tag (shared Tag primitive; a finished retro says FINISHED) — two lines + one tag, nothing more | N1/N3 + G1 (session 4) |
| **The decision bar** — sticky under the header (`top-14`, opaque, z below the header's): filter chips on the left, the review's one act on the right, and nothing else. See "The decision bar" below | G5 (the chips) + owner, session 7: *"When I scroll the filter … they scroll away; I want them to stick to the top … just add a button next to the filters (filters on the left, finish button on the right)"* |
| Record index — every record of the shown revision: state icon + #num + truncated title, one-click jump sharing G5's landing mechanic; entries hidden by the filter dim and go inert; no heading, no counts, no scroll-spy. **`wide:`+**: a rail beside the reading column, sticky and capped at the viewport. **Below `wide:`**: a list glyph on the *left* of the sticky header opening a `min(26rem, 100vw − 4rem)` sheet from the left edge; a tap jumps and closes the sheet on the way. Exactly one mount exists at a time | G2 (session 4; v2 C21, v1 #1) + owner, session 7: *"On iPad, I don't see the issues list that enable me to jump to specific issues by clicking on them. On iPad they should open in a left panel just like comments open from the right panel"* — which overturns session 4's "no drawer, no button to open it" ruling on the one screen he reviews on |
| Comments panel — **the one place a comment is read or written**, holding every thread on the retrospective, record-level included. A record thread carries an anchor line `#num · title` over the section's title, one click back to the record. Threads show their opening message with replies behind a count that opens one level; each message reads `actor · rev N`; a human (never the AI) can resolve one, and a settled thread collapses to a dimmed line carrying a check and the word "Resolved". **`wide:`+**: a rail beside the reading column, threads scrolling above a composer that does not. **Below `wide:`**: one glyph with a thread count on the *right* of the sticky header, opening a `min(48rem, 100vw − 4rem)` sheet from the right edge. **Both sheets take that one rule**: as wide as their cap allows, and never covering the last 4rem of the page — a *fixed* strip rather than a proportion, so the phone keeps a thumb's worth of page to tap back through and the iPad spends the rest on the panel (session 9: *"the flyouts should have a rule that makes them leave X pixels uncovered, rest should all be covered"*). Exactly one mount at a time; neither has a heading. Hidden entirely when the review is read-only and carries no thread at all | retro 3 `r-retro-level-comments` (the threads) + retro 4 `r-review-actions-pinned` (the placement — *"on the side or have a fly[out] experience … what we had previously was better"*) + owner, session 7: *"Replace inline comments in retro body with comments in the side panel … This enables human to see all comments in one place"* and *"it can be wider … but dont make it too much either"* (22rem → 26rem, and → 48rem in session 9: *"for iPad the flyouts need to be wider to take more space"*) |
| "Revision N available" banner — announce, never swap the content under the reviewer; click loads revision N | BACKLOG item 6 "announce, don't swap"; realtime design |

### Records list

One column, records in `num` order. Per record:

| element | pays for it |
|---|---|
| `num`, `title`, `type` badge (issue/feature) | D1 identity; scanning a review |
| Verdict: **Approve · Decline · Revise** actions + current state; the chosen one wears its state's tone and `aria-pressed`, and pressing it again returns the record to pending | the product's core loop; KC-0010 explicit approve; retro 4 `r-verdict-revise` (*"either I'm going to approve either I'm going to decline or either I'm going to request a revision… if I click it again it should undo it. And there should be a clear indication as to what is already selected"*) |
| ~~Hold: a **Hold / Release** button with an optional one-line reason, and a `HELD` tag~~ **removed, retro 4 `r-remove-hold`** | It shipped per retro 3 `r-hold-semantics` and the owner removed it on sight: the toggle named the action, so the current state was unreadable, and *"I can achieve the whole thing by selecting something to be only done with the human in the loop"* — `involvement`, which is already on the decision. Nothing on a record survives a finished review now |
| Narrative sections: problem · human words (verbatim + cleaned) · root cause (five-whys) · workaround ·**solutions** | D1 — the content under review |
| **Solutions: one to three, lowest level first, exactly one marked recommended.** Each carries its own bullets, its own footprint and its own level. The owner's design is a **tab strip** — tab title `Solution N · L<level>`, `*` on the AI's recommendation, ✓ on the one he selected, the recommended tab open by default, the tab body **led by the canonical level label** and then carrying the bullets and the footprint. The level leads since retro 10 `r-level-legend-below-fold` — *"move the Level right after the tabs so that the user can immediately see what L2 means"* — because the gloss was the body's last element and sat below the fold on any long solution, a screen away from the tab that named the level. It is the order the single-solution branch already had, so a solution now reads the same way in both shapes. **That is what ships** (session 7, lane s7-solutions-ui): a real tablist (one tab-order stop, arrows walk it), both markers a glyph plus a screen-reader word, and a **Select this solution** button on every tab that is not the current pick — the tickmark's only setter. Selecting is local until a verdict carries it, the dials' own edit-then-commit contract; switching tabs is viewing and writes nothing | the owner, dictated: *"let's say it can think of 3 different solutions each in a tab within the retro card… some indication like a `*` that shows what is solution recommended by the AI and then a tickmark that indicates what the human actually selected… It should always be sorted from lower level solution to high level solution. By default the recommended tab should be open"* |
| ~~Narrative sections: agreed direction · footprint~~ **replaced by solutions, and still rendered for the records that carry them** | Retros 1–5 are full of records filed with one direction and one footprint. Human data is never rewritten and their comment threads are anchored to those two sections, so the card keeps the branch that renders one, forever. Nothing writes another |
| Defaults row: severity (1–5) · involvement — pre-filled from the AI's proposals, editable by the human; enum labels use the "what — why" convention. **The solution-level radio list renders only on a record with a level of its own** — on a record that proposes solutions the ceiling comes with the solution the human picks, and a second control setting it would be a second answer that can disagree. The read-only level line renders on legacy records only — on a solutions record the ✓-marked tab's own title carries the approved ceiling and the decided tab opens on its full canonical label, so a line in the decision block would be the same answer twice on one card | D1 human decision fields; v2 rules "the human's values are what file" + radio-list rendering; the owner's multi-solution design |
| **Labels the record wears**, as tags beside the verdict — read-only here, and absent entirely on a record nobody has labelled | session 10, the owner: *"usually labels are just labels"*. The card shows them because a label is a classification and this is where a reviewer is scanning; it does **not** edit them, because a verdict is what this page is for and the record's own page is where a record is marked up |
| **An `in progress` tag beside the verdict** when somebody has picked the record up, and nothing at all when nobody has | RL-50 — a claimed record is "visible in the review UI as an 'in progress' badge". It is driven by the `claim` field on `records.list` and never inferred from a verdict, a lifecycle position or the passage of time; it is not a position on either axis (a claimed record is still open and still approved), which is why it is a tag of its own rather than a fourth lifecycle state. It arrives live: the claim is taken in the AI's own process and the card re-reads `records.list` off `RecordClaimed`, and a resolve gives the record back so the mark goes with the fix. The record's own page carries it too; the flat records page deliberately does not |
| Reviewer note (free text, per record) | D1 `reviewerNote` — the human's free channel |
| One **Comment** button per narrative section. It renders no thread and opens no composer here: it *aims* the comments panel's one composer at that section, shows an anchor chip above it saying where the next comment lands, and opens the sheet first on the widths that have one | BACKLOG item 6 "comment threads"; session 7's move of every thread into the panel |
| ~~Per-section comment threads rendered in the card~~ **removed, session 7** | *"Replace inline comments in retro body with comments in the side panel (look at the old UI how it was done there) - This enables human to see all comments in one place."* A reviewer had to walk the whole page to find out what had been said. `records.get` no longer carries threads at all; `threads.list` is the one query that holds them |
| Root-cause gutter rows carry `min-w-0 break-words` on the prose cell | retro 5 `r-incident-line-overflow` — a token nothing can break otherwise floors the cell's min-content above the column and the end of the line is lost behind the slot's clip |
| "decided on rev k" marker when a decision carried over unchanged content | D2 carry-over — the human must see what he is trusting |

### The decision bar

Sticky under the app header, as wide as the reading column, holding two things:
the filter chips and the review's one act. Nothing else may go on it.

| element | pays for it |
|---|---|
| Filter chips — one per state a review can reach, each with a live count; independent toggles; `hold` only on a store that carries one | G5 (KC-0021); retro 4 `r-remove-hold` |
| ~~A label filter here~~ **deliberately absent.** The review is one retrospective's round and the reviewer is deciding it; narrowing by classification is what the flat records page is for, and a fifth chip family on this bar is the shape `r-additional-filters` already ruled out | session 10 |
| **Finish review** — the page's one terminal action, on the right. Refused while any record is effectively pending, and the refusal names them in a **popover on the button itself**, dismissed by Escape or a press elsewhere, with the keyboard handed back to the button | D3 finish gate; `ReviewFinished`; retro 4 `r-one-finish-button` + `r-request-changes-multi-press` |
| Once pressed this round: the button goes disabled and a compact **Sent** mark appears beside it, carrying the sentence about what the AI does next on its accessible name and its tooltip | retro 4 `r-request-changes-multi-press` — the press needs an acknowledgment, and a bar has no room for the sentence |
| Once the AI has closed the review: the button is **replaced** by a check icon and the words *Retro submitted* — shape and word, never a colour alone, asserted in both themes | owner, session 7: *"Once a review is finished the botton should be replace with an icon and text that indicates that the retro has been submitted"* |
| On a pinned older revision: the read-only sentence stands where the act would be | ux-brief 03 — history is not a place to decide from |
| ~~**Request changes**~~ **removed, retro 4 `r-one-finish-button`** | It shipped because the event pair had two names and the UI mirrored them one button each. The owner met the contradiction that invites — comments full of asks, then a Finish press that says there are none — and ruled: *"there should be just one button… it should be clear from the content of the comments rather than from a redundant button I can press wrong."* The AI reads the round and either files the next revision or closes the retro |
| ~~Pending count ("3 of 9 pending") in a box at the end of the reading column~~ **removed, session 7** | *"I want the box at the bottom that says like 'X of Y pending - Review finished ...', I want it removed."* The pending chip on the same bar carries the number live, and two copies on one strip are two numbers to keep in agreement |

One explicit button, pressed once. Nothing on this page ever infers a decision
from silence, scroll position, or time — and finishing is not the end of the
retrospective: the retro goes read-only when the AI closes it, which arrives
over the event stream like any other change.

The bar is also where the filter puts a reviewer down when their filter empties
(`r-departure-keyboard-focus`): the keyboard moves to the act and the page does
not scroll, because a sticky bar was never off screen.

### Deliberately absent in v0

Requests panel (Tier 2) · record history view (`?record=<rid>&view=history`,
Tier 2 — renders a stub) · revision diffing (KC-0011: history is per record,
never whole-revision) · bulk actions · keyboard shortcuts · filters/search ·
edit-narrative anywhere (the human corrects via comments → next revision).

## Other routes

- **`/` dashboard — REDEFINED by KC-0020 (iteration 2): a flat list of retros.**
  One row per retro, newest first: title · "Retro #n · Session S" (ordinal within
  the session, not the autoincrement id) · session cwd · state (+ pending count
  while reviewing) · click → `/retros/:retroId`. No project cards, no grouping,
  no summary strip — harbor's **visual language only**, its information
  architecture is superseded. Spec: the iteration-2 shortlist (private project
  records), N4/N5. **Built — session 4** (`routes/index.tsx`, `dashboard/retro-row.tsx`;
  identity strings shared with the review header via `lib/retro-identity.ts`;
  empty state = one quiet line; no error state, no live updates — deliberate,
  a retro adds them back if wanted). It takes the same measure as the review
  page since session 7 — the whole of the owner's width ask, and the suite
  asserts the same three numbers from both features so "consistent" is a thing
  that can fail rather than a thing to eyeball.
- **`/records`** — the flat records page, **built session 8** (`routes/records.tsx`,
  `records/records-row.tsx`): every record of every retrospective in one list, each
  row leading with its own identity line, its verdict and its lifecycle. The
  lifecycle chips are on the bar and the verdict and requester slices sit behind
  the popover the review bar already uses; a record is resolved or reopened from
  the row itself, which keeps working after the review that decided it closed.
  **Session 10 adds the fourth filter and the row's label tags.** The label
  filter goes behind the icon rather than on the bar, and that one could never
  have gone on it: verdict and requester are closed vocabularies of five values
  and two, where a label vocabulary is whatever the human typed — fifteen labels
  would wrap the bar to four lines. The group appears only on a store where some
  record wears something, the same call the bar makes about the verdict nobody
  can give any more; within the dimension the chips are an OR. Attribute filters
  are **deferred**: a value filter is a different control entirely — a name, an
  operator and a value — and no evidence yet says which of the four types wants
  one.
  Rows link to `/records/:globalId`, and back the other way through the retro
  with `?record=`.
- **`/settings`** — the two vocabularies and one switch, **built session 10**
  (`routes/settings.tsx`, `components/settings/vocabulary.tsx`). It exists
  because the definitions are global — the owner: *"adding those will require
  setting up a settings page, because each label or attribute is going to be a
  global thing"* — and it holds three sections in this order: the
  **AI-config-write switch** (OWNER RULING 2), **Labels**, **Attributes**. The
  switch is first because it is the only thing on the page that is a promise
  rather than a list, and the sentence under it says what actually enforces it,
  which is not this page (`config-write.service.ts`).
  Each vocabulary offers **create, rename, retire** and nothing else: no colour,
  no description, no usage count, no reordering, and no delete — a delete is not
  a thing this product does, because retiring is what keeps a name readable on
  the records that already wear it. A retired row stays on the list, dimmed and
  marked, keeps its rename and loses only Retire. A refusal line under each
  vocabulary shows the server's own sentence, and it earns its place precisely
  because the page does **not** restate the name rules: without it a refused
  write would do nothing visible at all. Reached by one link in the dashboard's
  header slot, beside the records link — the second and last that slot should
  hold. Deliberately absent: theme (it is in the chrome on every page), stage and
  server settings (`retro doctor` owns those), and export configuration.
- **`/records/:id`** — one record's own page, **built session 9**
  (`routes/records_.$recordId.tsx` — the underscore opts the route out of nesting
  under `/records`): the identity line as the way back to the retro, the verdict
  and status tags, the same narrative rendering the review card uses, the same
  lifecycle controls, and a plain chronological timeline of who did what and when.
  A withdrawn record answers not-found.
- **`/projects/:id`** — dead stub; no project construct (KC-0020). Nothing
  builds on it.
- **`/sessions/:id`** — breadcrumb + title + one-line placeholder; unknown ids
  render "not found" (ux-brief 03). Session page's live notes are later.
- **Review-page parity items** (v2 had them; picked from the shortlist, not
  auto-built): retro header G1 · record index rail G2 · comment presentation
  G3 · review-level threads/requests G4 · filter-to-pending flow G5 (G5 reverses
  this file's "read in full" stance — owner's word required).

## Mechanics (item 6 implementation constraints)

- React 19 + TanStack Router/Query + shadcn + Tailwind v4; styling copied from
  `harbor`'s language.
- **The styling vocabulary is the whole stylesheet chain, not one file** (retro 6
  `r-stylesheet-vocab-blind`): custom variants and theme tokens come from
  `apps/web/src/styles.css` **and** the stylesheets its first lines import —
  `tailwindcss`, `tw-animate-css` and `shadcn/tailwind.css`, the last of which
  registers `data-active`, `data-checked`, `data-horizontal` and their siblings.
  Reading `styles.css` alone shows this project's token overrides and none of the
  vocabulary, so a claim that a variant or token does not exist is checked
  against the chain: grepping the entry stylesheet once declared live selectors
  dead, and the false conclusion reached a rewrite, a file comment and a commit
  message before a plant that failed to fail exposed it.
- R-MOCK-LOCK from the first commit: the only tRPC mock is the single typed
  module `apps/web/test/trpc-mock.ts` derived from `AppRouter`.
- Realtime: subscription feed drives the revision banner and incoming AI thread
  replies (`docs/design/realtime.md`); the mock feeds it in tests.
- `data-testid`-only selection in tests; every behavior above gets a Gherkin
  scenario (testing.md suite 4).
