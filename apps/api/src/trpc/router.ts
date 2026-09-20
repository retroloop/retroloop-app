import type { App } from '@retro/core'
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server'
import type { Tailer } from '#events/tailer'
import { createContextFactory } from '#trpc/context.factory'
import { attributesRouter } from '#trpc/routers/attributes.router'
import { decisionsRouter } from '#trpc/routers/decisions.router'
import { eventsRouter } from '#trpc/routers/events.router'
import { labelsRouter } from '#trpc/routers/labels.router'
import { recordsRouter } from '#trpc/routers/records.router'
import { retrosRouter } from '#trpc/routers/retros.router'
import { reviewRouter } from '#trpc/routers/review.router'
import { settingsRouter } from '#trpc/routers/settings.router'
import { threadsRouter } from '#trpc/routers/threads.router'
import { createCallerFactory, router } from '#trpc/trpc'

/**
 * The whole server surface — **twenty-nine procedures**: the eight of the v0
 * table in trpc.md, plus `retros.list`, the dashboard's read model, plus
 * `threads.list` and `threads.resolve`, plus `records.listAll`,
 * `records.setLifecycle` and `records.byId`, plus the twelve labels-and-
 * attributes procedures, plus `labels.unretire` and `attributes.unretire`, plus
 * `records.relate`.
 *
 * **The number in that sentence has been wrong before** — it once said
 * twenty-six while the router declared twenty-eight, because the un-retire pair
 * moved the three lists that fail loudly and not the prose here, which nothing
 * checks. It is corrected in the commit that moves the count again, and named as
 * a hazard rather than tidied away: a hand-maintained count beside three
 * machine-checked ones is the copy that goes stale, and the two lists that name
 * the procedures out loud (`apps/api/test/procedures.test.ts`,
 * `apps/web/test/procedure-set.spec.ts`) are what a reader should trust.
 *
 * The count is the point. `apps/web`'s typed mock must cover this router **key
 * for key** (R-MOCK-LOCK), and a procedure-set meta-test compares the two, so
 * every procedure added here is a procedure someone has to mock and keep
 * mocked. Anything the review page can derive from what is already here — the
 * review status from the record list, for instance — does not get one until a
 * page needs it and cannot afford the alternative.
 *
 * What the six beyond the v0 table bought, and why nothing already here could:
 *
 * - `retros.list` — no arrangement of the others answers "what retros exist".
 * - `threads.list` — the one call that answers "every comment in this
 *   retrospective", which is what the comments panel is. It began as the read
 *   path review-level threads never had, since those hang off no record and no
 *   record-scoped call could reach them; it is now the only wire source for any
 *   thread, because `records.get` stopped carrying a record's threads when the
 *   inline rendering that read them went away.
 * - `threads.resolve` — the human marking a thread dealt with
 *   (`r-resolvable-comments`). It is a write nothing else expresses: a comment
 *   is not a verdict on the conversation, and resolution is set rather than
 *   inferred.
 * - `records.listAll` — the flat cross-retro records page. No arrangement of the
 *   record calls above answers it: every one of them is scoped to one
 *   retrospective, and the whole point of the page is that it is not.
 * - `records.setLifecycle` — the human marking a record resolved after it was
 *   fixed. A second axis beside the verdict, written after the review that
 *   settled the verdict has closed, so nothing already here could carry it.
 * - `records.byId` — one record, reached by the number a human reads off the
 *   page (the record page at `/records/:id`). Every other record read here takes
 *   `(retroId, rid)`, which is what addresses a record (A5) and is not something
 *   anybody types or bookmarks; this is the one that runs the global sequence
 *   backwards. Widening `records.get` instead would have put the identity line,
 *   the lifecycle and a whole timeline on every card of every review to serve
 *   one page — and `records.get` answers for a record *inside* a review,
 *   revision and all, which is the question this one is not asking.
 *
 * **The twelve labels-and-attributes procedures are the largest single widening
 * this router has taken, and the count is the argument for why they are three
 * namespaces rather than fewer.** Labels and attributes are two pure primitives
 * — labels are just labels, attributes carry data, and composition is the user's
 * own convention and never a system mechanism — so `labels.*` and `attributes.*`
 * are separate namespaces rather than one `definitions.*` that would be the
 * first place a reader looked for the pairing the system does not have. Each
 * carries four definition procedures (list, define, rename, retire) plus the one
 * human write on a record.
 *
 * `settings.*` is the third, and it is two procedures because it is a standing
 * guarantee rather than a preference: if it is disabled, the user can be certain
 * that the AI cannot mess around. Nothing already here could carry it — a global
 * switch has no retrospective to hang off — and folding it into `labels.*` would
 * have made a guarantee that governs both primitives look like a property of
 * one.
 *
 * **What is deliberately not here**, on the every-procedure-is-a-thing-to-mock
 * rule: no `unretire` (the settings page is create, rename, retire, and a fourth
 * control waits for a retro to ask), no `retype` (a value already stored was
 * accepted under the old type), and no per-record read of either — a record's
 * labels ride on `records.get`, `records.byId` and `records.listAll`, which the
 * pages are already holding.
 *
 * **`records.setLifecycle` is the first write here whose use case the AI may
 * also make.** That is not a hole in the actor model: this procedure passes the
 * context's actor, which is `human` and cannot be anything else, and the AI's
 * half goes through the CLI in its own process like every other AI write. What
 * is new is that the use case below accepts both — the AI marks what it fixed,
 * the human marks from the browser.
 *
 * **`records.relate` is the second, and it is the AI's more than the human's**:
 * both actors can relate records, each relation carries how-they-relate words,
 * and the relation reads from both sides, so that the AI can easily find past
 * records and build holistic solutions. It is one procedure for two acts, on the
 * standing `records.setLifecycle` pattern — the input widens here and the
 * procedure count does not move — with a boolean rather than a status word,
 * because relating and un-relating are on and off and no third position exists
 * for a relation to be in. Nothing already here could carry it: every other
 * record write is addressed by `(retroId, rid)`, and this is the one that names
 * **two** records, by the global number, across two retrospectives.
 *
 * **`holds.set/clear` is gone** (`r-remove-hold`). Hold left the verdict axis
 * earlier and got two procedures of its own; seen live, the toggle was
 * unreadable and the concept already covered — the whole thing can be achieved
 * by marking something to be done only with the human in the loop, so no hold is
 * needed. That is `involvement`, which `decisions.record` already writes. The
 * `holds` table keeps its rows.
 *
 * **`requests.*` is gone, and it is not coming back** (`r-remove-requests`).
 * Three procedures shipped a second ask channel beside the review's comment
 * threads, and it was rejected on first contact: comments at the review level
 * are enough, with one individual request per comment. A comment is the one
 * channel now. The request rows those procedures wrote stay in the store as
 * history; nothing here reaches them.
 */
export const appRouter = router({
  retros: retrosRouter,
  records: recordsRouter,
  decisions: decisionsRouter,
  threads: threadsRouter,
  review: reviewRouter,
  events: eventsRouter,
  labels: labelsRouter,
  attributes: attributesRouter,
  settings: settingsRouter,
})

/**
 * **The mock-lock anchor.** `apps/web` imports this type and only this type; the
 * mock is `satisfies` a mapped type over it, so a procedure that changes shape
 * here fails the web build rather than the browser.
 */
export type AppRouter = typeof appRouter

/**
 * The wire shapes, keyed by procedure, derived rather than restated.
 *
 * These exist for `apps/web`. testing.md requires the typed mock's
 * inputs/outputs to be `inferRouterInputs`/`inferRouterOutputs` of this router,
 * and the same rule bans every `@trpc/server` import from the browser SPA — so
 * the helpers are applied here, at the producer, and travel across the type-only
 * edge as ordinary types. Because every procedure declares `.output()`, these
 * are exactly the `views.schema.ts` shapes; because they are inferred, they
 * cannot fall out of step with the router the way a second declaration would.
 */
export type AppRouterInputs = inferRouterInputs<AppRouter>
export type AppRouterOutputs = inferRouterOutputs<AppRouter>

export type CreateCallerOptions = {
  readonly app: App
  readonly tailer: Tailer
}

/**
 * A caller with a real context and no HTTP — how testing.md's suite 2 exercises
 * every procedure, its error mapping and its subscription.
 */
export function createCaller(options: CreateCallerOptions) {
  return createCallerFactory(appRouter)(createContextFactory(options))
}
