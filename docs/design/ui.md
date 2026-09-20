# UI design — review page (v0) and the rest

> **The dashboard's look is settled by a separate visual reference; this file
> covers what that reference does not:** the review page (the only fully-built
> route in Tier 1) and the stubs. The route contract is stated here; data shapes
> per `docs/design/data-model.md`.

**Governing rule: every element earns its place.** Each element below
names the requirement that pays for it. Anything not listed is deliberately
absent — a retrospective can add it back.

## Review page — `/retros/:retroId` (v0)

`?rev=k` pins an older revision (read-only). Default view = latest revision.

### Page measure — one, everywhere

**Every route takes the same measure: `max-w-5xl`, and `wide:max-w-[96rem]` on a
screen with room for three columns**, so that the home page's width and the
review page's width are consistent with each other. It replaced an `AppShell
wide` prop the review page passed exactly while its comment rail was mounted,
which made a page's width a function of a query's answer.

`wide` is `--breakpoint-wide: 92rem` (1472px, `styles.css`) and it is the only
width this page's geometry turns on: the measure widens there, the reading column
takes its cap there, and the two rails mount there. 1536px is what the three
columns and their gutters come to — 24 + 288 + 32 + 768 + 32 + 368 + 24 — so the
last column ends where the header's last control does rather than short of
it, and past 1536 the page centres instead of growing, because a very wide
screen should not let the page run all the way to the sides.

**Round two of the same dial, and every pixel of it went to the rails**: the
measure widened again and all of the gain went to the left index panel and the
right comments panel.
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
656 — and it is flagged as an open trade rather than settled here.

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
| Breadcrumb `Project › Session › Retro #n · Rev k` (project crumb only when the session has one) | route contract |
| Theme toggle (dark/light/system, persisted) | route contract |
| Review header: the retro's name (its title, or the `Retro <id> — <cwd basename>` fallback) + identity line `Retro #n · Session S · cwd` + the retro's state tag (shared Tag primitive; a finished retro says FINISHED) — two lines + one tag, nothing more | the session identity and the title on the wire; the retro header |
| **The decision bar** — sticky under the header (`top-14`, opaque, z below the header's): filter chips on the left, the review's one act on the right, and nothing else. See "The decision bar" below | the filter chips; the filters must stick to the top rather than scrolling away, with the filters on the left of the bar and the finish button on its right |
| Record index — every record of the shown revision: state icon + #num + truncated title, one-click jump sharing the filter flow's landing mechanic; entries hidden by the filter dim and go inert; no heading, no counts, no scroll-spy. **`wide:`+**: a rail beside the reading column, sticky and capped at the viewport. **Below `wide:`**: a list glyph on the *left* of the sticky header opening a `min(26rem, 100vw − 4rem)` sheet from the left edge; a tap jumps and closes the sheet on the way. Exactly one mount exists at a time | the record index rail. On an iPad the record index must still be reachable, opening in a left panel the way comments open from the right panel — which overturns the earlier "no drawer, no button to open it" stance on exactly that width |
| Comments panel — **the one place a comment is read or written**, holding every thread on the retrospective, record-level included. A record thread carries an anchor line `#num · title` over the section's title, one click back to the record. Threads show their opening message with replies behind a count that opens one level; each message reads `actor · rev N`; a human (never the AI) can resolve one, and a settled thread collapses to a dimmed line carrying a check and the word "Resolved". **`wide:`+**: a rail beside the reading column, threads scrolling above a composer that does not. **Below `wide:`**: one glyph with a thread count on the *right* of the sticky header, opening a `min(48rem, 100vw − 4rem)` sheet from the right edge. **Both sheets take that one rule**: as wide as their cap allows, and never covering the last 4rem of the page — a *fixed* strip rather than a proportion, so the phone keeps a thumb's worth of page to tap back through and the iPad spends the rest on the panel — a flyout leaves a fixed number of pixels uncovered and covers the rest. Exactly one mount at a time; neither has a heading. Hidden entirely when the review is read-only and carries no thread at all | review-level threads (the threads) + the panel placement, which belongs on the side or in a flyout rather than in the card + the move of every thread into the side panel, so the human sees all comments in one place. The panel may be wider, but not excessively so (22rem → 26rem, and → 48rem so an iPad flyout takes more space) |
| "Revision N available" banner — announce, never swap the content under the reviewer; click loads revision N | the review page's "announce, don't swap"; realtime design |

### Records list

One column, records in `num` order. Per record:

| element | pays for it |
|---|---|
| `num`, `title`, `type` badge (issue/feature) | record identity; scanning a review |
| Verdict: **Approve · Decline · Revise** actions + current state; the chosen one wears its state's tone and `aria-pressed`, and pressing it again returns the record to pending | the product's core loop; explicit approve; the reviewer either approves, declines or asks for a revision, clicking the chosen one again undoes it, and what is already selected is clearly indicated |
| ~~Hold: a **Hold / Release** button with an optional one-line reason, and a `HELD` tag~~ **removed** | It shipped once and was removed: the toggle named the action, so the current state was unreadable, and the same thing is achieved by marking a record as one to be done only with the human in the loop — `involvement`, which is already on the decision. Nothing on a record survives a finished review now |
| Narrative sections: problem · human words (verbatim + cleaned) · root cause (five-whys) · workaround ·**solutions** | the content under review |
| **Diagnostic data: one collapsed block per record**, headed `Diagnostic data`, opened by a click, rendered through the same markdown subset as the card's other prose — and not rendered at all on a record that carries none. Display only: no comment affordance, nothing the finish gate reads, and no `readOnly` branch, because opening a block is not an act on the record | It is the one thing on a card that starts shut, and it does not breach *a record is read in full*: what is behind it is evidence the AI gathered rather than part of what the reviewer is deciding — it anchors no thread and no verdict is about it. Open by default it would be a screen of pasted output between the cause and the workaround on every record of a round |
| **Solutions: one to three, lowest level first, exactly one marked recommended.** Each carries its own bullets, its own footprint and its own level. The design is a **tab strip** — tab title `Solution N · L<level>`, `*` on the AI's recommendation, ✓ on the one the human selected, the recommended tab open by default, the tab body **led by the canonical level label** and then carrying the bullets and the footprint. The level sits right after the tabs so that a reader immediately sees what L2 means, because the gloss was the body's last element and sat below the fold on any long solution, a screen away from the tab that named the level. It is the order the single-solution branch already had, so a solution now reads the same way in both shapes. **That is what ships**: a real tablist (one tab-order stop, arrows walk it), both markers a glyph plus a screen-reader word, and a **Select this solution** button on every tab that is not the current pick — the tickmark's only setter. Selecting is local until a verdict carries it, the dials' own edit-then-commit contract; switching tabs is viewing and writes nothing | the multi-solution design: the AI may think of up to three different solutions, each in a tab within the record card, with a `*` showing which one the AI recommends and a tickmark showing which one the human actually selected; they are always sorted from lower solution level to higher, and the recommended tab is open by default |
| ~~Narrative sections: agreed direction · footprint~~ **replaced by solutions, and still rendered for the records that carry them** | Early retrospectives are full of records filed with one direction and one footprint. Human data is never rewritten and their comment threads are anchored to those two sections, so the card keeps the branch that renders one, forever. Nothing writes another |
| Defaults row: severity (1–5) · involvement — pre-filled from the AI's proposals, editable by the human; enum labels use the "what — why" convention. **The solution-level radio list renders only on a record with a level of its own** — on a record that proposes solutions the ceiling comes with the solution the human picks, and a second control setting it would be a second answer that can disagree. The read-only level line renders on legacy records only — on a solutions record the ✓-marked tab's own title carries the approved ceiling and the decided tab opens on its full canonical label, so a line in the decision block would be the same answer twice on one card | the human's decision fields; the human's values are what file, plus the radio-list rendering; the multi-solution design |
| **Labels the record wears**, as tags beside the verdict — read-only here, and absent entirely on a record nobody has labelled | a label is just a label. The card shows them because a label is a classification and this is where a reviewer is scanning; it does **not** edit them, because a verdict is what this page is for and the record's own page is where a record is marked up |
| **An `in progress` tag beside the verdict** when somebody has picked the record up, and nothing at all when nobody has | a claimed record is visible in the review UI as an "in progress" badge. It is driven by the `claim` field on `records.list` and never inferred from a verdict, a lifecycle position or the passage of time; it is not a position on either axis (a claimed record is still open and still approved), which is why it is a tag of its own rather than a fourth lifecycle state. It arrives live: the claim is taken in the AI's own process and the card re-reads `records.list` off `RecordClaimed`, and a resolve gives the record back so the mark goes with the fix. The record's own page carries it too; the flat records page deliberately does not |
| Reviewer note (free text, per record) | `reviewerNote` — the human's free channel |
| One **Comment** button per narrative section. It renders no thread and opens no composer here: it *aims* the comments panel's one composer at that section, shows an anchor chip above it saying where the next comment lands, and opens the sheet first on the widths that have one | the review page's comment threads; the move of every thread into the panel |
| ~~Per-section comment threads rendered in the card~~ **removed** | Inline comments in the retro body gave way to comments in the side panel, so the human sees every comment in one place. A reviewer had to walk the whole page to find out what had been said. `records.get` no longer carries threads at all; `threads.list` is the one query that holds them |
| Root-cause gutter rows carry `min-w-0 break-words` on the prose cell | a token nothing can break otherwise floors the cell's min-content above the column and the end of the line is lost behind the slot's clip |
| "decided on rev k" marker when a decision carried over unchanged content | carry-over — the human must see what they are trusting |

### The decision bar

Sticky under the app header, as wide as the reading column, holding two things:
the filter chips and the review's one act. Nothing else may go on it.

| element | pays for it |
|---|---|
| Filter chips — one per state a review can reach, each with a live count; independent toggles; `hold` only on a store that carries one | the filter chips; `hold` is a retired verdict |
| ~~A label filter here~~ **deliberately absent.** The review is one retrospective's round and the reviewer is deciding it; narrowing by classification is what the flat records page is for, and a fifth chip family on this bar is the shape already ruled out for additional filters | the flat records page is where classification narrows |
| **Finish review** — the page's one terminal action, on the right. Refused while any record is effectively pending, and the refusal names them in a **popover on the button itself**, dismissed by Escape or a press elsewhere, with the keyboard handed back to the button | the finish gate; `ReviewFinished`; one finish button, and a mis-press costs one press |
| Once pressed this round: the button goes disabled and a compact **Sent** mark appears beside it, carrying the sentence about what the AI does next on its accessible name and its tooltip | the press needs an acknowledgment, and a bar has no room for the sentence |
| Once the AI has closed the review: the button is **replaced** by a check icon and the words *Retro submitted* — shape and word, never a colour alone, asserted in both themes | once a review is finished the button is replaced by an icon and text saying the retro has been submitted |
| On a pinned older revision: the read-only sentence stands where the act would be | history is not a place to decide from |
| ~~**Request changes**~~ **removed** | It shipped because the event pair had two names and the UI mirrored them one button each. That invites a contradiction — comments full of asks, then a Finish press that says there are none — so there is just one button, and what the round asks for is clear from the content of the comments rather than from a redundant button that is easy to press wrong. The AI reads the round and either files the next revision or closes the retro |
| ~~Pending count ("3 of 9 pending") in a box at the end of the reading column~~ **removed** | The pending chip on the same bar carries the number live, and two copies on one strip are two numbers to keep in agreement |

One explicit button, pressed once. Nothing on this page ever infers a decision
from silence, scroll position, or time — and finishing is not the end of the
retrospective: the retro goes read-only when the AI closes it, which arrives
over the event stream like any other change.

The bar is also where the filter puts a reviewer down when their filter
empties: the keyboard moves to the act and the page does not scroll, because a
sticky bar was never off screen.

### Deliberately absent in v0

Requests panel (Tier 2) · record history view (`?record=<rid>&view=history`,
Tier 2 — renders a stub) · revision diffing (history is per record,
never whole-revision) · bulk actions · keyboard shortcuts · filters/search ·
edit-narrative anywhere (the human corrects via comments → next revision).

## Other routes

- **`/` dashboard — redefined in iteration 2: a flat list of retros.**
  One row per retro, newest first: title · "Retro #n · Session S" (ordinal within
  the session, not the autoincrement id) · session cwd · state (+ pending count
  while reviewing) · click → `/retros/:retroId`. No project cards, no grouping,
  no summary strip — that reference's **visual language only**, its information
  architecture is superseded. **Built** (`routes/index.tsx`,
  `dashboard/retro-row.tsx`; identity strings shared with the review header via
  `lib/retro-identity.ts`; empty state = one quiet line; no error state, no live
  updates — deliberate, a retrospective adds them back if wanted). It takes the
  same measure as the review page — the whole of the width requirement, and the
  suite asserts the same three numbers from both features so "consistent" is a
  thing that can fail rather than a thing to eyeball.
- **`/records`** — the flat records page, **built** (`routes/records.tsx`,
  `records/records-row.tsx`): every record of every retrospective in one list, each
  row leading with its own identity line, its verdict and its lifecycle. The
  lifecycle chips are on the bar and the verdict and requester slices sit behind
  the popover the review bar already uses; a record is resolved or reopened from
  the row itself, which keeps working after the review that decided it closed.
  **A later iteration adds the fourth filter and the row's label tags.** The label
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
- **`/settings`** — the two vocabularies and one switch, **built**
  (`routes/settings.tsx`, `components/settings/vocabulary.tsx`). It exists
  because the definitions are global — each label and each attribute is a
  global thing, which needs a settings page of its own — and it holds three
  sections in this order: the **AI-config-write switch**, **Labels**,
  **Attributes**. The switch is first because it is the only thing on the page
  that is a promise rather than a list, and the sentence under it says what
  actually enforces it, which is not this page (`config-write.service.ts`).
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
- **`/records/:id`** — one record's own page, **built**
  (`routes/records_.$recordId.tsx` — the underscore opts the route out of nesting
  under `/records`): the identity line as the way back to the retro, the verdict
  and status tags, the same narrative rendering the review card uses, the same
  lifecycle controls, and a plain chronological timeline of who did what and when.
  A withdrawn record answers not-found.
- **`/projects/:id`** — dead stub; no project construct. Nothing
  builds on it.
- **`/sessions/:id`** — breadcrumb + title + one-line placeholder; unknown ids
  render "not found". Session page's live notes are later.
- **Review-page parity items** (picked deliberately, not auto-built): retro
  header · record index rail · comment presentation · review-level
  threads/requests · filter-to-pending flow (the last of these reverses this
  file's "read in full" stance, so it needs an explicit decision before it is
  built).

## Mechanics (implementation constraints)

- React 19 + TanStack Router/Query + shadcn + Tailwind v4; styling follows the
  project's own visual language.
- **The styling vocabulary is the whole stylesheet chain, not one file**:
  custom variants and theme tokens come from
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
