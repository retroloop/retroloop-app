/**
 * **R-MOCK-LOCK: this is the one and only tRPC mock in `apps/web`.**
 * (docs/design/testing.md §R-MOCK-LOCK)
 *
 * It is a *link*, not a network fake. `vite build --mode mocked` resolves
 * `@/lib/transport` to this file, so the app runs its real tRPC client against
 * an in-browser implementation of the real router: there is no request to
 * intercept, no handler to register, and no response literal to invent. Every
 * input and output below is `AppRouterInputs`/`AppRouterOutputs` — the router's
 * own `.input()`/`.output()` schemas, inferred at the producer and carried over
 * the type-only `web -> api` edge — so a procedure that changes shape breaks
 * this file at compile time rather than in a browser.
 *
 * `mockRouter satisfies MockRouter` is the exhaustiveness half: `MockRouter` is
 * a mapped type over the real router's procedure paths, so a procedure that is
 * missing, extra, or mis-shaped fails to compile. **It stops at the procedure.**
 * An extra field canned into an answer compiles clean, and no amount of care
 * here changes that: TypeScript infers an arrow handler's return type from its
 * literal and then checks the whole function type for assignability, so
 * excess-property checking never fires on what a handler returns (retro 6
 * `r-mock-extra-field-blind`, proven by repro). That fourth direction belongs to
 * `scripts/check-mock-parity.ts`, which runs every procedure below against this
 * world and validates each answer with the schema the real router validates it
 * with. `test/procedure-set.spec.ts` checks the same set at runtime, and
 * `apps/api/test/procedures.test.ts` checks the server's half.
 *
 * The world below is stateful on purpose. A mock that answered from a table of
 * canned responses could not show a decision carrying over into the next
 * revision, because carry-over is a *relationship* between two revisions and a
 * verdict — so the scenarios would be asserting the fixture rather than the
 * behaviour. Here, approving a record and then filing a revision produces the
 * carry-over the same way the server does (`effectiveDecision` in core).
 *
 * Two rules follow from that, and neither is optional (`r-mock-world-semantics`).
 *
 * **The world lives as long as the module does, and a reload starts a new one.**
 * `world = initialWorld()` runs when this file is evaluated, so reloading the
 * page throws away everything a scenario has done to it. Never `page.reload()`
 * after a `MockControl` call or after a reviewer's act: what comes back is the
 * opening fixture, and a scenario that asserts against it is asserting nothing
 * it performed. Move between pages by navigating — the breadcrumb, a link, the
 * router — which keeps the module and therefore the world. The one deliberate
 * reload in the suite (`chrome.feature`, the theme) is testing what *survives*
 * a reload, and it performs nothing on the world first.
 *
 * **A field the world does not model is never canned.** A literal written into a
 * procedure's answer so that a scenario can see a value is a fixture asserting
 * itself: nothing computed it, so nothing can be wrong about it, and the
 * scenario reads as evidence while proving only that someone typed the expected
 * string here. Model the field — put it in `World`, derive it the way the server
 * derives it — or leave it out and let `satisfies MockRouter` fail the build,
 * which is the honest answer to "the mock cannot say yet". Constants of the
 * fixture are a different thing and are fine: the retrospective under review is
 * the first of its session, so its `retroNumber: 1` is what the world *is*, not
 * a gap papered over.
 *
 * **The number a record shows is derived, not seeded.** Since global record ids,
 * `#n` is the record's place in the whole store — so it depends on which
 * retrospectives the world holds and on which draft first mentioned the record,
 * and it is minted here by the arithmetic the server mints it by (`mintRecordIds`).
 * A literal on a seed would have gone on saying `#1` for every retrospective's
 * first record however the page was broken, which is exactly the fixture-asserting-
 * itself the rule above forbids. Two consequences worth knowing before reading a
 * scenario: the retro under review is the world's first, so its numbers agree
 * with its own `num`s and a scenario that wants the two to differ reaches for
 * `crossRetro` or for a record `fileRevision()` introduces.
 *
 * **The world holds one retrospective, unless a scenario asks for the stage the
 * records page is about.** Every page but `/records` is scoped to a single
 * retrospective and the fixture is that one; `crossRetro` starts the world with
 * two more, closed, one of them in a second session and a second working
 * directory, because a flat page across all of them can render one retro's
 * answer under another's identity and no one-retro world can catch it. The flag
 * is read once, before the app boots, like the three beside it.
 */

import type { AppRouter, AppRouterInputs, AppRouterOutputs } from '@retro/api'
import { TRPCClientError, type TRPCLink } from '@trpc/client'
import type { TrpcLinkFactory } from '@/lib/link-contract'

/* ── the router, as types ─────────────────────────────────────────────────── */

type Namespace = keyof AppRouterInputs & string

/** Every procedure of the real router, dotted the way `_def.procedures` keys it. */
export type ProcedurePath = {
  [N in Namespace]: `${N}.${keyof AppRouterInputs[N] & string}`
}[Namespace]

type InputOf<P extends ProcedurePath> = P extends `${infer N extends Namespace}.${infer L}`
  ? L extends keyof AppRouterInputs[N]
    ? AppRouterInputs[N][L]
    : never
  : never

type OutputOf<P extends ProcedurePath> = P extends `${infer N extends Namespace}.${infer L}`
  ? N extends keyof AppRouterOutputs
    ? L extends keyof AppRouterOutputs[N]
      ? AppRouterOutputs[N][L]
      : never
    : never
  : never

/** What one yield of a streaming procedure carries. */
type StreamItem<P extends ProcedurePath> = OutputOf<P> extends AsyncIterable<infer T> ? T : never

/** The streaming procedures — found by their output, not listed by hand. */
type SubscriptionPath = {
  [P in ProcedurePath]: OutputOf<P> extends AsyncIterable<unknown> ? P : never
}[ProcedurePath]

type Call<P extends ProcedurePath> = (input: InputOf<P>) => OutputOf<P>
type Stream<P extends SubscriptionPath> = (
  input: InputOf<P>,
  emit: (item: StreamItem<P>) => void,
) => () => void

/**
 * The shape the mock must have: one handler per procedure of `AppRouter`, no
 * more and no fewer. This is enforcement layer 1 (testing.md).
 */
type MockRouter = {
  readonly [P in ProcedurePath]: P extends SubscriptionPath ? Stream<P> : Call<P>
}

/* ── the shapes the world is built from, all derived ──────────────────────── */

type RecordDetail = OutputOf<'records.get'>
type Narrative = RecordDetail['record']

/**
 * A record **as the AI authored it** — what the World stores, and what a
 * revision's blob holds on the server.
 *
 * It differs from the wire `Narrative` in exactly one place: `proposed` carries
 * a `solutionLevel` only on a record filed before solutions existed, because
 * that is the only shape whose draft authored one. On a record with solutions
 * the level the record proposes is the recommended solution's, and the server
 * computes it on the way out (`proposedLevel`) rather than storing a second
 * copy that could contradict the array. The mock does the same, so a fixture
 * cannot say one thing while the array says another.
 */
type RecordSeed = Omit<Narrative, 'proposed'> & {
  readonly proposed: Omit<Narrative['proposed'], 'solutionLevel'> &
    Partial<Pick<Narrative['proposed'], 'solutionLevel'>>
}
type Decision = RecordDetail['decision']
type Thread = OutputOf<'threads.open'>
type Message = Thread['messages'][number]
/**
 * A thread as the *store* keeps it — everything the wire carries except
 * `resolved`, which is derived from the resolution rows below the way the server
 * derives it from the `thread_resolutions` table.
 */
type ThreadRow = Omit<Thread, 'resolved'> & {
  /**
   * Which retrospective it hangs on. Not on the wire, and deliberately: every
   * thread procedure is addressed to a retrospective already, so the column is
   * how the world keeps them apart rather than something a page is told.
   */
  readonly retroId: number
}
type RecordSummary = OutputOf<'records.list'>['records'][number]
/**
 * The state a page is *shown*, four values since the intermediate status
 * shipped — and the three a retrospective is actually *in*, which is what a
 * world row holds.
 *
 * `submitted` is subtracted rather than restated, so the two stay one edit
 * apart: the wire is still the only place either list is written down. A world
 * that could store `submitted` is the canned-fact bug in its purest form
 * (`r-mock-world-semantics`) — a scenario would arrange the answer it then went
 * on to assert, and the derivation the server actually runs would be untested.
 * The mock derives it from its own `ReviewFinished` rows instead, exactly where
 * the read models derive it from the store's (`retro.view.ts`).
 */
type RetroState = OutputOf<'retros.get'>['state']
type StoredRetroState = Exclude<RetroState, 'submitted'>
/** One row of the flat cross-retro records page, and its lifecycle half. */
type RecordListAllRow = OutputOf<'records.listAll'>[number]
type Lifecycle = RecordListAllRow['lifecycle']
/** The record page's timeline, as the wire types it — three kinds, discriminated on `kind`. */
type RecordTimeline = OutputOf<'records.byId'>['timeline'][number][]

/**
 * The two vocabularies, and what a record wears from them — all four derived
 * from the router rather than restated, like everything else in this file.
 *
 * A **definition** carries a retirement timestamp, because that is what the
 * settings page manages; a **record's** label carries the boolean, because on a
 * record the only question is whether the page may still offer it
 * (`views.schema.ts`).
 */
type LabelDefinition = OutputOf<'labels.list'>[number]
type AttributeDefinition = OutputOf<'attributes.list'>[number]
type RecordLabel = OutputOf<'records.get'>['labels'][number]
type RecordAttribute = OutputOf<'records.byId'>['attributes'][number]
type AttributeType = AttributeDefinition['type']

/**
 * What the stream actually hands the browser: `tracked()`'s envelope, id and
 * payload, because that is what tRPC delivers to `onData` for a tracked
 * subscription. The id is the SSE `Last-Event-ID` a reconnect would resume from.
 */
type TrackedEvent = StreamItem<'events.onRetro'>
type WireEvent = TrackedEvent['data']

/** A decision as the store keeps it: one row per version, never edited (D4). */
type DecisionRow = {
  /** Its retrospective, because a rid is minted per retrospective and repeats across them. */
  readonly retroId: number
  readonly rid: string
  readonly revision: number
  /**
   * When the human pressed the verdict — a real column (`decisions.decided_at`)
   * and a line of the record page's timeline.
   *
   * It arrived with that timeline and not before: nothing rendered a decision's
   * moment until a page put every verdict on a list ordered by time, and a row
   * that had no moment could not have been on it. The **version** beside it is
   * still derived rather than stored, because "1-based and dense per record" is
   * exactly a row's position among that record's rows and a second copy could
   * disagree with the array.
   */
  readonly at: string
  readonly state: Decision['state']
  readonly severity: Decision['severity']
  readonly solutionLevel: Decision['solutionLevel']
  /** Which solution the human's verdict is for, or null on a record with none. */
  readonly selectedSolution: Decision['selectedSolution']
  readonly involvement: Decision['involvement']
  readonly reviewerNote: string | null
}

/**
 * One act of the human settling a thread, or taking it back
 * (`r-resolvable-comments`). Rows, not a flag: reopening appends a version and
 * the highest one is what stands, exactly as `thread_resolutions` does.
 */
type ResolutionRow = {
  readonly threadId: number
  readonly resolved: boolean
}

/**
 * One act of somebody marking a record done, or taking it back (the owner's
 * session-8 lifecycle ask). Rows rather than a field on the record, because
 * that is what `record_lifecycle` is: reopening appends a version and the
 * highest one stands, so nothing here overwrites what was done before.
 *
 * `actor` is a real column on this table and on no other, because it is the one
 * both actors write — the AI marking what it fixed (`MockControl.aiResolve`,
 * that act in its own process) and the human marking from the page.
 *
 * Keyed by `(retroId, rid)`, exactly as the server keys it: a rid is minted per
 * retrospective, so one retro's `r-stale-lock` is not another's. The fixture
 * mints that very rid twice (`crossRetro`) so a page that keyed a row, a link or
 * a write by rid alone fails a scenario rather than only a contract test.
 */
type LifecycleRow = {
  readonly retroId: number
  readonly rid: string
  readonly status: InputOf<'records.setLifecycle'>['status']
  readonly refs: readonly string[]
  readonly note: string | null
  readonly actor: NonNullable<Lifecycle['actor']>
  /**
   * When the act was taken. It was `FIXED_TIME`, canned into `lifecycleOf`'s
   * answer, until the record page put these rows on a timeline: an entry read
   * as a state does not need a moment and a line on a list ordered by time
   * does, so the row grew the column the table has always had.
   */
  readonly at: string
}

/**
 * One act of the human putting a label on a record, or taking it off (the
 * owner's session-10 ruling: *"usually labels are just labels"*).
 *
 * Rows rather than a set on the record, because that is what `record_labels` is:
 * removing a label appends a version and the highest one stands, so nothing here
 * overwrites what was done before. There is **no payload** — a definition id, a
 * version and a bit is the whole of what applying a label means, which is the
 * ruling rather than an omission.
 *
 * Keyed by `(retroId, rid, labelId)` exactly as the server keys it, and the
 * version sequence is dense **per label**: a record wearing three labels holds
 * three independent v1 rows, so a fold that grouped one column short would read
 * one label's history as another's.
 */
type RecordLabelRow = {
  readonly retroId: number
  readonly rid: string
  readonly labelId: number
  readonly version: number
  readonly applied: boolean
}

/**
 * The same, for a value — with the one difference that makes attributes the
 * queryable primitive: `value` is absent where the act was *clearing* it, which
 * is a different fact from never having carried one and is the reason clearing
 * is an append rather than a delete.
 */
type RecordAttributeValueRow = {
  readonly retroId: number
  readonly rid: string
  readonly attributeId: number
  readonly version: number
  readonly value: string | null
}

/**
 * One act of somebody saying two records belong together, or taking it back —
 * the owner's session-11 ask: *"both actors can relate records, each relation
 * carries how-they-relate words, and the relation reads from both sides."*
 *
 * **Keyed on two global ids and on nothing else**, exactly as `record_relations`
 * is: a relation names two records and may name them across two retrospectives,
 * so the `(retroId, rid)` pair every other table here is keyed on is not a handle
 * it could use. The rows are directed as authored and are **never mirrored** —
 * *"reads from both sides"* is a property of the read (`relationsOf` asks about
 * both columns), so a mock holding a second reversed row would be answering a
 * question the server answers from one.
 *
 * The version sequence is dense per **ordered pair**, and un-relating carries
 * forward the words of the relation it takes off — both of which the world has
 * to model rather than can, because a page reads what stands and a write numbers
 * itself after what came before.
 */
type RecordRelationRow = {
  /**
   * The store's own row id, as this world keeps it — strictly increasing over
   * the table and never reused.
   *
   * It is here because the **order** of a record's relations is decided by it:
   * the server hands back the rows in force sorted by the id of the row in
   * force, so an act on an old pair moves that pair to the end
   * (`relation.view.ts` §relationsInForce). A fold that handed back its map's
   * insertion order instead would keep the old pair first forever — and would
   * satisfy the output schema and the parity check exactly as well, because an
   * array of the right shape in the wrong order is still an array of the right
   * shape. Nothing but a reading catches it, which is why the world models the
   * id rather than leaving the order to a `Map`.
   */
  readonly seq: number
  readonly fromId: number
  readonly toId: number
  readonly version: number
  readonly applied: boolean
  readonly how: string
  readonly actor: NonNullable<Lifecycle['actor']>
  readonly at: string
}

/**
 * One row of the store's global record sequence.
 *
 * **Modelled rather than canned**, and this one has to be: the number a record
 * shows is a fact about the whole world — which retrospectives exist, in what
 * order, and which draft a record first appeared in — so a literal on a seed
 * would be a fixture asserting itself, and would go on saying `#1` for every
 * retrospective's first record no matter what the page did
 * (`r-mock-world-semantics`). It is derived here by the arithmetic the server
 * uses: retrospectives in id order, each one's filed revisions in order, records
 * by `num` within a revision, minted at first appearance and never moved
 * (`record-id.model.ts`, `20260830090000_create_record_ids.ts`).
 *
 * It lives beside the revisions rather than on a `RecordSeed`, exactly as it
 * lives beside the blob on the server, so a seed stays what the AI would have
 * submitted.
 */
type RecordIdRow = {
  readonly id: number
  readonly retroId: number
  readonly rid: string
}

type Revision = {
  readonly n: number
  readonly createdAt: string
  /**
   * The name the AI proposed with this draft, or null when it proposed none.
   * Per revision rather than per retrospective because that is where the server
   * keeps it: a title rides on the revision payload, and the **latest**
   * revision's title is the retrospective's name (KC-0020, N3).
   */
  readonly title: string | null
  readonly records: readonly RecordSeed[]
}

/** The session identity every retro view carries — one shape, one reader (KC-0020). */
type SessionIdentity = OutputOf<'retros.get'>['session']

/**
 * One retrospective, as the world keeps it.
 *
 * The world held exactly one of these inline until the flat records page needed
 * a second (`crossRetro` below): `state`, `filed` and `finishedAt` were fields
 * of the world itself, and every retro-addressed procedure closed over the
 * single `RETRO_ID`. They are per-retrospective here because that is what they
 * are on the server — and because a page showing several at once is a page that
 * can render one retro's answer against another's identity, which no world with
 * one retrospective in it can fail.
 */
type Retrospective = {
  readonly retroId: number
  /** Its place **in its session** — the "Retro #n" of the identity line (KC-0011). */
  readonly retroNumber: number
  readonly session: SessionIdentity
  readonly project: string | null
  readonly startedAt: string
  readonly revisions: readonly Revision[]
  /** How many of `revisions` the AI has filed. The rest do not exist yet. */
  filed: number
  state: StoredRetroState
  finishedAt: string | null
}

/* ── the fixture ──────────────────────────────────────────────────────────── */

/** The retrospective under review — the one every page but `/records` is about. */
const RETRO_ID = 1
const SESSION_ID = 1
const PROJECT = 'retro'
/** The session's immutable working directory — the identity anchor (KC-0020, N1). */
const CWD = '/Users/haider/Developer/retro'
/** The name the first two drafts gave the retrospective (KC-0020, N3). */
const TITLE = 'The lock, the arrows and the silent tailer'
const FIXED_TIME = '2026-08-24T09:00:00.000Z'
const SECOND_REVISION_TIME = '2026-08-24T11:30:00.000Z'
const THIRD_REVISION_TIME = '2026-08-24T14:05:00.000Z'

/**
 * The rest of the stage: a second retrospective in the same session, and one in
 * a different session in a different working directory. Both closed, both filed
 * before the one under review — which is what a store looks like by the time the
 * owner wants a page across all of it.
 *
 * Every value here is a fixture constant of the same standing as `retroNumber: 1`
 * is for the retro under review: it is what this world *is*, not a field canned
 * into an answer. See `crossRetro` for why they are arranged rather than
 * performed, and why they are behind a flag.
 */
const SECOND_RETRO_ID = 2
const SECOND_RETRO_TIME = '2026-08-22T10:15:00.000Z'
const SECOND_RETRO_TITLE = 'The departure that never landed'

const THIRD_RETRO_ID = 3
const SECOND_SESSION_ID = 2
const SECOND_CWD = '/Users/haider/Developer/harbor'
const THIRD_RETRO_TIME = '2026-08-23T16:40:00.000Z'
const THIRD_RETRO_TITLE = 'Two days on harbor'

/**
 * When the two closed reviews were decided, and when the AI fixed the one record
 * it has already fixed. Both are after the retrospective they belong to and
 * before the day the reviewer opens the page, which is what makes them what this
 * world *is* rather than numbers typed to satisfy an assertion.
 *
 * They exist because the record page puts a record's acts on a **list ordered by
 * time**. A fixture where every act shared one timestamp would let that list
 * come back in any order and still pass, which is the assertion that cannot fail
 * (`r-assertion-value-distinctiveness`).
 */
const SECOND_RETRO_DECIDED = '2026-08-22T12:30:00.000Z'
const SECOND_RETRO_FIXED = '2026-08-22T15:20:00.000Z'
const THIRD_RETRO_DECIDED = '2026-08-23T18:05:00.000Z'

/**
 * The moment the reviewer opens the page — after everything the fixture
 * arranged, and where the world's own clock starts.
 *
 * Every write a scenario performs is stamped a minute after the write before it
 * (`stamp()`), because two acts a reviewer takes are not simultaneous and a
 * world that said they were could not order them. It is the smallest clock that
 * makes the timeline a timeline: still frozen relative to real time, so nothing
 * here depends on when the suite runs.
 */
const WORLD_OPENS = '2026-08-25T09:00:00.000Z'
const WRITE_STEP_MS = 60_000

const staleLock: RecordSeed = {
  rid: 'r-stale-lock',
  num: 1,
  title: 'Deploy blocked on a stale lock file',
  type: 'issue',
  problem:
    'A crashed `retro up` leaves its lock file behind, and every later start refuses ' +
    'to run against a stage it believes is already served. The stage is fine; only the ' +
    'file is wrong, and nothing in the refusal says which.',
  humanWords: [
    {
      verbatim: 'it says the port is taken and it is NOT taken, i checked',
      cleaned: 'The refusal claims the port is in use when it is not.',
      context: 'after the third failed start',
    },
  ],
  rootCause: {
    whatHappened: 'The lock file outlived the process that wrote it.',
    whys: [
      // The one why written the way a real one is — "**Why did X?** because Y",
      // a full line of prose rather than a clause. The gutter label beside it is
      // the only thing on this page a long line can squeeze (retro 4
      // `r-whys-labels`): with a short why there is no shrink pressure at all,
      // and the control for "one line each" passes without observing anything.
      '**Why did the start refuse?** A lock file was sitting in the stage directory, and ' +
        'the guard reads the file itself as proof that something is already serving it.',
      'The lock file was present because the previous process did not remove it.',
      'It did not remove it because it was killed rather than shut down.',
      'Nothing else removes it, because the lock has no owner check.',
    ],
    root: 'The lock records that someone held it, not who — so no one can tell it is stale.',
  },
  workaround: 'Delete the lock file by hand before starting.',
  /**
   * **The record in the shape the owner asked for**: one to three solutions,
   * lowest level first, exactly one recommended.
   *
   * **Three of them, with the recommendation in the middle**, because every
   * question this fixture has to answer is a question about *which* — which one
   * is recommended, which one is selected, which tab opens, which position a
   * comment names. With two, "the recommended" and "the last" are the same
   * answer and a page reading either would pass; with the flag on the middle
   * one, first, last and recommended are three different tabs, and the ✓ can
   * land on a fourth reading (his own pick) without colliding with any of them.
   * Three is also the widest strip the owner's design allows, which is the one
   * that has to fit the narrow screen he reviews on.
   *
   * The nested sub-point inside the second one's bullets is the other half of the
   * list subset: a bullet indented under another is a bullet, not a run of
   * literal dashes.
   */
  agreedDirection: null,
  footprint: null,
  solutions: [
    {
      bullets:
        '- **Say which file:** name the lock file the refusal is about, so the reader ' +
        'can look at it (human-suggested).\n' +
        '- **Nothing else changes:** the stale lock still stops the start; it just stops ' +
        'being anonymous.',
      footprint: 'apps/cli/src/commands/up.ts',
      level: 1,
      recommended: false,
    },
    {
      bullets:
        '- **Own the lock:** Write the pid into the lock and treat a lock whose pid is gone ' +
        'as free (agreed).\n' +
        '  - **The check is the pid, not the file:** a lock whose writer is gone is free, ' +
        'whatever the file says.\n' +
        '- **Say which file:** name the lock file the refusal is about (human-suggested).',
      footprint: 'apps/cli/src/server/lock.ts · apps/cli/src/commands/up.ts',
      level: 2,
      recommended: true,
    },
    {
      bullets:
        '- **A lease, not a file:** the stage hands out a lease with an expiry and the ' +
        'server renews it while it runs; a lease nobody renewed is over.\n' +
        '- **Everything that touches the stage conforms:** the CLI, the server and ' +
        'the doctor all read the lease, so the shape of the lock file changes for all ' +
        'three at once.',
      /**
       * One line here is deliberately wider than the reading column on the iPad
       * in portrait: a footprint is an author-aligned drawing, a real one names
       * real paths, and the tab body puts two flex ancestors between this `<pre>`
       * and the card. That is the shape `r-incident-line-overflow` was filed on,
       * and a fixture whose every line fits puts no pressure on it at all
       * (`r-assertion-value-distinctiveness`).
       */
      footprint:
        'apps/cli/src/server\n' +
        '├── lease.ts               [CREATE] the lease record and its clock\n' +
        '├── lock.ts                [DELETE] replaced by the lease\n' +
        '└── ../commands\n' +
        '    ├── up.ts              [UPDATE] take a lease, renew it while serving\n' +
        '    └── doctor.ts          [UPDATE] report the lease instead of the file\n' +
        'packages/core/src/application/use-cases/sessions/renew-stage-lease.use-case.ts        ' +
        '[CREATE] the renewal, one tick at a time, and the only writer of the lease row',
      level: 4,
      recommended: false,
    },
  ],
  requester: 'human',
  impacts: 'human',
  // No `solutionLevel`: on a record with solutions the level it proposes is the
  // recommended solution's, and `proposedLevel()` computes it — the same thing
  // the server does, rather than a literal that can drift from the array above.
  proposed: { severity: 2, involvement: 'pull-request' },
}

/**
 * The record whose prose is *authored*, the way every real record is.
 *
 * Bold leads, a bullet list, a numbered list, a hard line break, inline code and
 * a literal `<b>` — because that is what the AI writes into these fields and
 * what the reader was being shown as raw source (r-prose-renders-raw). A fixture
 * of unformatted sentences could not have caught it, and did not, for three
 * retrospectives.
 */
const bulletResponses: RecordSeed = {
  rid: 'r-bullet-responses',
  num: 2,
  title: 'Answers come back as bullet lists when prose was asked for',
  type: 'feature',
  problem:
    '- **Fragments, not sentences:** asked for an explanation, the assistant answers ' +
    'in fragments joined by arrows.\n' +
    '- **The reader pays:** The reader has to reassemble the sentence before they can ' +
    'judge the claim.',
  humanWords: [
    {
      verbatim: 'stop giving me arrows, write it like a person',
      cleaned: 'Write the answer as prose rather than as an arrow chain.',
      context: null,
    },
  ],
  rootCause: {
    whatHappened: 'Brevity was optimised for over readability.',
    whys: [
      'The answer was compressed into fragments.',
      'Fragments were chosen because they are shorter.',
      'Shorter was treated as better without asking who reads it.',
    ],
    root: 'Length was the target; being understood on the first read was not.',
  },
  workaround:
    'none — the reader reassembles it by hand.\n' +
    'Asking for <b>prose</b> in the prompt does not stick.',
  /**
   * **Left in the shape it was filed in, deliberately.** Two of the three
   * fixture records still carry one direction and one footprint, because retros
   * 1–5 are full of them and both shapes have to render forever: a mock that
   * converted every record would leave the legacy branch of the card untested
   * from the day it stopped being written.
   */
  solutions: null,
  agreedDirection:
    '1. **Prose by default:** say it in complete sentences and drop detail instead of ' +
    'grammar (agreed).\n' +
    '2. **No arrow chains:** a line built from `->` is a sentence that was skipped.',
  // A footprint is a drawing, not prose: box characters, and the tags in a
  // column. It is the one field whose runs of spaces carry meaning, and the
  // only one that must survive rendering character for character.
  footprint:
    '/Users/haider/Developer/retro\n' +
    '├── CLAUDE.md              [UPDATE] the prose rule, stated once\n' +
    '└── docs\n' +
    '    └── EXECUTION.md       [UPDATE] the answer-shape check in the inner loop',
  requester: 'human',
  impacts: 'human',
  proposed: { severity: 3, solutionLevel: 1, involvement: 'interactive' },
}

const silentTailer: RecordSeed = {
  rid: 'r-silent-tailer',
  num: 3,
  title: 'The tailer stops without saying so',
  type: 'issue',
  problem:
    'When the poll loop throws, the loop ends and every open page simply stops ' +
    'receiving events. Nothing logs, and the pages look merely quiet.',
  /**
   * The quote carries a newline and a pair of asterisks, because human words are
   * the one field nothing may reinterpret: the line breaks are his and so are
   * the asterisks, and both have to reach the page unchanged (the amendment to
   * r-prose-renders-raw). The cleaned half is a restatement of the same words
   * and is read the same way.
   */
  humanWords: [
    {
      verbatim: 'the ipad just went dead, i thought i lost wifi\nno **error**, no spinner, nothing',
      cleaned:
        'A stopped stream is indistinguishable from a lost connection.\n' +
        'He read the silence as dropped wifi.',
      context: 'reviewing on the iPad',
    },
  ],
  rootCause: {
    /**
     * The one field in this fixture carrying a token nothing can break, and it
     * is here on purpose (retro 5 `r-incident-line-overflow`): the gutter rows
     * are flex pairs, and a cell whose min-content is floored by a 150-character
     * run is a cell that pushes past the reading column. A resume cursor is what
     * a tailer would actually print in its last line, so this is the real shape
     * of the content rather than a string invented to fail a layout.
     *
     * Every three-viewport outline in the suite reads this record, so the
     * `does not scroll sideways` checks stand on real pressure now instead of
     * on prose that was always going to wrap.
     */
    whatHappened:
      'An exception escaped the poll loop and ended it, holding the cursor ' +
      'eyJyZXRyb0lkIjoxLCJzZXNzaW9uSWQiOjEsImFmdGVySWQiOjQyMTcsImF0IjoiMjAyNi0wOC0yNFQxNDowNTowMC4wMDBaIiwidGFpbCI6dHJ1ZSwibGFzdE5hbWUiOiJDb21tZW50QWRkZWQifQ',
    whys: [
      'The loop ended on the first error.',
      'It ended because the error was not caught inside the iteration.',
      'It was not caught because the loop assumed reads cannot fail.',
      'Reads can fail: the database is a file another process writes.',
      'Nothing reported the stop, so the failure looked like silence.',
    ],
    root: 'The tailer treats a recoverable read error as the end of its life.',
  },
  // The fence is the one place inside prose where nothing is read: the asterisks
  // and the tag below are characters in a log line, and the indentation is the
  // content rather than structure.
  workaround:
    'Restart the server. The log line to look for:\n' +
    '\n' +
    '```\n' +
    '  tailer: read failed  **not bold**  <b>not markup</b>\n' +
    '    retrying in 1s\n' +
    '```',
  /** The old shape as well — see `bulletResponses` above. */
  solutions: null,
  agreedDirection:
    'Catch per iteration, keep polling, and surface the failure count (agreed). ' +
    'The page should say the stream is down (AI-suggested).',
  footprint: 'apps/api/src/events/tailer.ts',
  requester: 'ai',
  impacts: 'human',
  /**
   * `upstream` is the one thing in this fixture no draft could propose today:
   * KC-0021 cut it, and retro 1 carries one. It is here so the scenarios can
   * show what happens to a record that holds a level nothing offers — the radio
   * list has nothing to select, a verdict that says nothing about the level
   * leaves it alone, and the read-only rendering still names it.
   */
  proposed: { severity: 1, solutionLevel: 'upstream', involvement: 'autonomous' },
}

/**
 * Each revision rewrites exactly one record's problem statement, which is what
 * makes carry-over visible: the records that did not change keep whatever
 * verdict they were given and say which revision gave it, and the one that
 * changed goes back to pending (D2).
 */
const bulletResponsesRewritten: RecordSeed = {
  ...bulletResponses,
  problem:
    '- **Fragments, not sentences:** asked for an explanation, the assistant answers ' +
    'in fragments joined by arrows.\n' +
    '- **Worst where it costs most:** the long answers, where reassembling the sentence ' +
    'is dearest.\n' +
    '\n' +
    'The reader pays for the writer being brief.',
}

const silentTailerRewritten: RecordSeed = {
  ...silentTailer,
  problem:
    'When the poll loop throws, the loop ends and every open page stops receiving ' +
    'events. Nothing logs it, so a dead stream and a quiet afternoon look the same ' +
    'from the iPad.',
}

/**
 * The record that proposes **one** solution, and the only one in the fixture.
 *
 * A record with a single solution has nothing to switch between, and since retro
 * 6 `r-single-solution-no-tabs` it renders without the strip — the owner: *"When
 * there is only one solution, you shouldn't show the tab because showing the tab
 * causes confusion."* Nothing here can show that unless a record is in that
 * shape, and none was.
 *
 * It arrives **with revision 3** rather than widening revisions 1 and 2. The AI
 * filing a new record in a new revision is the product's own path to this shape,
 * so no arrangement flag has to invent it — and every scenario that enumerates
 * this fixture's records by hand names the same three it always did.
 *
 * **Level 3**, which no other solution in this fixture proposes (the strip's are
 * 1, 2 and 4): a level shared with one of those would let a page reading the
 * wrong solution's level pass (`r-assertion-value-distinctiveness`). Recommended,
 * because exactly one solution always is — and with one solution that flag is
 * what makes the pick structurally the AI's, which is why nothing here asks the
 * reviewer to select it.
 */
const doctorBlind: RecordSeed = {
  rid: 'r-doctor-blind',
  num: 4,
  title: 'The doctor passes a stage the server will not serve',
  type: 'issue',
  problem:
    '- **`retro doctor` reports green on a stage `retro up` then refuses.** The two ' +
    'read different things and agree to disagree in silence.\n' +
    '- **The reviewer trusts the doctor**, because saying whether the stage is usable ' +
    'is the only job it has.',
  humanWords: [],
  rootCause: {
    whatHappened: 'The doctor checked that the stage directory exists; the server checks it opens.',
    whys: [
      '**Why did the doctor pass it?** It only ever asked whether the path was there.',
      'Opening the database was left to the caller, so nothing on the doctor path opened it.',
    ],
    root: 'The check and the use are two different questions, and only one of them was asked.',
  },
  workaround: 'Run `retro up` and read its refusal instead — the doctor adds nothing here.',
  agreedDirection: null,
  footprint: null,
  solutions: [
    {
      bullets:
        '- **Check by opening:** the doctor opens the stage the way the server does and ' +
        'reports what that answers, rather than testing for a directory.\n' +
        "- **One answer, one place:** the open lives beside the server's own, so the two " +
        'cannot drift again.',
      footprint:
        '/Users/haider/Developer/retro\n' +
        '└── apps\n' +
        '    └── cli\n' +
        '        └── src\n' +
        '            └── commands\n' +
        '                └── doctor.ts    [UPDATE] open the stage instead of stat-ing it',
      level: 3,
      recommended: true,
    },
  ],
  requester: 'ai',
  impacts: 'human',
  proposed: { severity: 3, involvement: 'autonomous' },
}

/**
 * Two revisions are already filed when a scenario starts, so `?rev=1` is a URL
 * that means something: an older revision, read-only, reachable the way the
 * route contract says it is. The third is what `window.retroMock.fileRevision()`
 * files while the reviewer is reading.
 *
 * The third proposes **no title**, which is the one way a retrospective loses
 * its name: the title is optional on the draft and the latest draft wins, so a
 * later revision that proposes none leaves the retro unnamed and the reader
 * falls back to "Retro #n — <cwd basename>" (KC-0020). That is a real product
 * state, and filing this revision is how a scenario reaches it.
 *
 * It also carries the fixture's one-solution record, which is the other thing
 * only a new revision can bring: a record that did not exist in the round before
 * it. See `doctorBlind`.
 */
const REVISIONS: readonly Revision[] = [
  {
    n: 1,
    createdAt: FIXED_TIME,
    title: TITLE,
    records: [staleLock, bulletResponses, silentTailer],
  },
  {
    n: 2,
    createdAt: SECOND_REVISION_TIME,
    title: TITLE,
    records: [staleLock, bulletResponsesRewritten, silentTailer],
  },
  {
    n: 3,
    createdAt: THIRD_REVISION_TIME,
    title: null,
    records: [staleLock, bulletResponsesRewritten, silentTailerRewritten, doctorBlind],
  },
]

const REVISIONS_ALREADY_FILED = 2

/* ── the rest of the stage: the retrospectives already closed ─────────────── */

/**
 * The records of the two closed retrospectives, kept short on purpose.
 *
 * The three above are the review page's fixture and carry everything that page
 * has to render — authored prose, both record shapes, a footprint wide enough to
 * push a layout. These four exist for the *flat* page, which reads a title, two
 * states, a requester, a severity and an identity line off each row and nothing
 * else. Writing them at the same length would be four more full records for the
 * reader of this file to hold, for no assertion anyone makes.
 *
 * They are still complete records, not stubs: `records.get` answers for them,
 * because a row on the records page links to its review page and a link that
 * lands on an error is not a link this fixture should be able to claim works.
 */
const flakyLanding: RecordSeed = {
  rid: 'r-flaky-landing',
  num: 1,
  title: 'The landing assertion fails on a loaded machine',
  type: 'issue',
  problem:
    'The scenario reads the record position while the page is still scrolling, so ' +
    'the sample it takes is whichever frame it caught.',
  humanWords: [
    {
      verbatim: 'this one keeps going red and then green, i dont trust the suite anymore',
      cleaned: 'A test that passes on the second run is not evidence.',
      context: null,
    },
  ],
  rootCause: {
    whatHappened: 'The assertion polled a position rather than a page at rest.',
    whys: [
      'The read happened mid-scroll.',
      'Nothing waited for the scroll to stop, because a scroll has no event that says it has.',
    ],
    root: 'A timing question was answered with a timeout.',
  },
  workaround: 'Run it again.',
  agreedDirection: null,
  footprint: null,
  solutions: [
    {
      bullets:
        '- **Sample at rest:** read the position only once two frames agree on it, and poll ' +
        'the sampling rather than the assertion.',
      footprint: 'apps/web/features/steps/review.steps.ts',
      level: 2,
      recommended: true,
    },
  ],
  requester: 'human',
  impacts: 'ai',
  proposed: { severity: 3, involvement: 'autonomous' },
}

const exportWidening: RecordSeed = {
  rid: 'r-export-widening',
  num: 2,
  title: 'The export could carry the lifecycle entries too',
  type: 'feature',
  problem: 'What was done about a record lives in the product and not in the document.',
  humanWords: [],
  rootCause: {
    whatHappened: 'The export was written before there were lifecycle entries to export.',
    whys: ['The document predates the table.'],
    root: 'Nothing decided either way; it simply was not a question yet.',
  },
  workaround: 'Read the records page.',
  /** The legacy shape, outside retro 1 — both shapes have to render forever. */
  solutions: null,
  agreedDirection: 'Leave it. Lifecycle is operational metadata and the document is the record.',
  footprint: 'apps/cli/src/export',
  requester: 'ai',
  impacts: 'human',
  proposed: { severity: 5, solutionLevel: 3, involvement: 'pull-request' },
}

/**
 * **The same rid as retro 1's first record, in a different retrospective.**
 *
 * That is not a copy-paste slip and it is the point of this seed: a rid is
 * minted per retrospective (A5, scout-core), so `(retroId, rid)` is the identity
 * everywhere, and the flat records page is the only surface in the product that
 * can hold two rows carrying the same rid at once. A page that keyed a row, a
 * link or a lifecycle write by rid alone renders two rows with one React key,
 * sends the wrong retrospective, or resolves the wrong record — and none of
 * those can fail in a world with one retrospective in it.
 *
 * Everything about it differs from retro 1's: a different title, a different
 * requester, a different verdict and a different severity, so a row that read
 * the wrong one of the two has nothing to hide behind.
 */
const staleLockOnHarbor: RecordSeed = {
  rid: 'r-stale-lock',
  num: 1,
  title: 'The stage lock survives a crash here too',
  type: 'issue',
  problem: 'The same lock file, in a checkout that has never run `retro doctor`.',
  humanWords: [],
  rootCause: {
    whatHappened: 'The lock outlived its process, again.',
    whys: [
      'The lock has no owner check.',
      'It was filed against the wrong package the first time.',
    ],
    root: 'One defect, filed twice, because two checkouts hit it two days apart.',
  },
  workaround: 'Delete the lock file by hand.',
  agreedDirection: null,
  footprint: null,
  solutions: [
    {
      bullets: '- **Close it as a duplicate:** the fix belongs to the other retrospective.',
      footprint: 'apps/cli/src/server/lock.ts',
      level: 1,
      recommended: true,
    },
  ],
  requester: 'ai',
  impacts: 'human',
  proposed: { severity: 5, involvement: 'autonomous' },
}

const ipadScroll: RecordSeed = {
  rid: 'r-ipad-scroll',
  num: 2,
  title: 'The reading column scrolls sideways on the iPad',
  type: 'issue',
  problem: 'A long unbroken token in a footprint widens the page instead of its own box.',
  humanWords: [
    {
      verbatim: 'i keep swiping the whole page left by accident',
      cleaned: 'The page itself scrolls horizontally, so a swipe moves everything.',
      context: 'reviewing on the iPad',
    },
  ],
  rootCause: {
    whatHappened: 'A flex child was floored by its content and pushed past the column.',
    whys: ['The child had no `min-w-0`.', 'Flex items refuse to shrink below min-content.'],
    root: 'The default is the wrong one for a column holding author-aligned drawings.',
  },
  workaround: 'Turn the iPad the other way up.',
  agreedDirection: null,
  footprint: null,
  solutions: [
    {
      bullets: '- **Let the box scroll:** `min-w-0` on the column, `overflow-x-auto` on the box.',
      footprint: 'apps/web/src/components/review/record-card.tsx',
      level: 2,
      recommended: true,
    },
  ],
  requester: 'human',
  impacts: 'human',
  proposed: { severity: 4, involvement: 'pull-request' },
}

const SECOND_RETRO_REVISIONS: readonly Revision[] = [
  {
    n: 1,
    createdAt: SECOND_RETRO_TIME,
    title: SECOND_RETRO_TITLE,
    records: [flakyLanding, exportWidening],
  },
]

const THIRD_RETRO_REVISIONS: readonly Revision[] = [
  {
    n: 1,
    createdAt: THIRD_RETRO_TIME,
    title: THIRD_RETRO_TITLE,
    records: [staleLockOnHarbor, ipadScroll],
  },
]

/**
 * The verdicts those two closed retrospectives were closed on.
 *
 * Seeded rather than performed, and it has to be: a finished review refuses a
 * verdict, so there is no act in the product that puts a decision on a closed
 * retrospective. They are the same `DecisionRow` shape a scenario writes, read
 * by the same `effectiveDecision`, so what the rows say about them is derived
 * exactly as it is for the retro under review — nothing here is a state canned
 * into an answer.
 *
 * **The four verdicts are four different verdicts**, and the counts they produce
 * are 3 pending · 2 approved · 1 declined · 1 revise. That spread is deliberate
 * (`r-assertion-value-distinctiveness`): a filter that narrowed on the wrong
 * word would have to land on a different count *and* a different set of rows.
 */
const CLOSED_DECISIONS: readonly DecisionRow[] = [
  {
    retroId: SECOND_RETRO_ID,
    rid: 'r-flaky-landing',
    revision: 1,
    at: SECOND_RETRO_DECIDED,
    state: 'approved',
    severity: 3,
    solutionLevel: 2,
    selectedSolution: 1,
    involvement: 'autonomous',
    reviewerNote: null,
  },
  {
    retroId: SECOND_RETRO_ID,
    rid: 'r-export-widening',
    revision: 1,
    at: SECOND_RETRO_DECIDED,
    state: 'declined',
    severity: 5,
    solutionLevel: 3,
    selectedSolution: null,
    involvement: 'pull-request',
    reviewerNote: 'The document is the record; lifecycle is not part of it.',
  },
  {
    retroId: THIRD_RETRO_ID,
    rid: 'r-stale-lock',
    revision: 1,
    at: THIRD_RETRO_DECIDED,
    state: 'revise',
    severity: 5,
    solutionLevel: 1,
    selectedSolution: 1,
    involvement: 'autonomous',
    reviewerNote: 'Say which retrospective it duplicates.',
  },
  {
    retroId: THIRD_RETRO_ID,
    rid: 'r-ipad-scroll',
    revision: 1,
    at: THIRD_RETRO_DECIDED,
    state: 'approved',
    severity: 4,
    solutionLevel: 2,
    selectedSolution: 1,
    involvement: 'pull-request',
    reviewerNote: null,
  },
]

/**
 * What the AI has already done about one of them — the only lifecycle entry the
 * world opens with, and the reason it opens with one at all.
 *
 * A lifecycle field is `{status:'open', refs:[], note:null, actor:null, at:null}`
 * until something populates it, so a fixture where every record starts open
 * would let a page render the *populated* half however it liked and never be
 * caught: every assertion would be exercising the empty half (F1's
 * null-until-populated finding, proved on the parity plan). One record therefore
 * starts resolved, with **both kinds of reference** — a bare SHA and a URL —
 * because the page treats them differently and a fixture carrying only one kind
 * cannot fail the branch it does not have.
 */
const CLOSED_LIFECYCLE: readonly LifecycleRow[] = [
  {
    retroId: SECOND_RETRO_ID,
    rid: 'r-flaky-landing',
    status: 'resolved',
    refs: ['9f3c1ab', 'https://github.com/haiderhameed/retro/pull/118'],
    note: 'Sampled at rest; the poll moved down onto the sampling.',
    actor: 'ai',
    at: SECOND_RETRO_FIXED,
  },
]

/* ── the vocabularies, and what the world opens wearing ───────────────────── */

/**
 * **Somebody created these**, which is the whole of "nothing hardcoded".
 *
 * The product ships zero labels and zero attributes — the owner: *"to keep it
 * flexible we will not hardcode any labels or attributes"* — so these are
 * fixture constants of the same standing as `retroNumber: 1`: they are what this
 * world *is*, because a human sat on the settings page and typed them. Nothing
 * under `apps/web/src` knows any of these names, `migrated` included; it is the
 * example the owner used, not a value the product knows about.
 *
 * The set is arranged so that **every branch a reader has** is on the fixture
 * before a scenario performs anything:
 *
 * - an offerable label that a record wears (`migrated`), which is the owner's
 *   own migrate story;
 * - an offerable label nobody wears (`needs triage`), which is what the "add a
 *   label" control has to offer;
 * - a **retired** label a record still wears (`wontfix`) — the case that only
 *   exists because retiring is not deleting, and the one a page can get wrong by
 *   dropping the tag or by offering it again;
 * - the same three shapes one table over, plus the four attribute types spread
 *   across them so no type is unrendered.
 */
const LABELS_DEFINED_AT = '2026-08-24T08:00:00.000Z'
const WONTFIX_RETIRED_AT = '2026-08-24T08:30:00.000Z'
const STORY_POINTS_RETIRED_AT = '2026-08-24T08:30:00.000Z'

const LABEL_MIGRATED = 1
const LABEL_NEEDS_TRIAGE = 2
const LABEL_WONTFIX = 3

const ATTRIBUTE_ISSUE_ID = 1
const ATTRIBUTE_MOVED_ON = 2
const ATTRIBUTE_STORY_POINTS = 3

/**
 * Ids are **per vocabulary and 1-based**, which is what SQLite's own
 * AUTOINCREMENT gives each table — not the world's shared `nextId` counter. That
 * matters for one reader outside the browser: `scripts/check-mock-parity.ts`
 * addresses definitions by literal id in its fixture run, and an id that moved
 * when an unrelated row was written would make the plan address a different
 * label every time it ran.
 */
const LABEL_DEFINITIONS: readonly LabelDefinition[] = [
  { id: LABEL_MIGRATED, name: 'migrated', retiredAt: null, createdAt: LABELS_DEFINED_AT },
  { id: LABEL_NEEDS_TRIAGE, name: 'needs triage', retiredAt: null, createdAt: LABELS_DEFINED_AT },
  {
    id: LABEL_WONTFIX,
    name: 'wontfix',
    retiredAt: WONTFIX_RETIRED_AT,
    createdAt: LABELS_DEFINED_AT,
  },
]

const ATTRIBUTE_DEFINITIONS: readonly AttributeDefinition[] = [
  {
    id: ATTRIBUTE_ISSUE_ID,
    name: 'external issue id',
    type: 'url',
    retiredAt: null,
    createdAt: LABELS_DEFINED_AT,
  },
  {
    id: ATTRIBUTE_MOVED_ON,
    name: 'moved on',
    type: 'date',
    retiredAt: null,
    createdAt: LABELS_DEFINED_AT,
  },
  {
    id: ATTRIBUTE_STORY_POINTS,
    name: 'story points',
    type: 'number',
    retiredAt: STORY_POINTS_RETIRED_AT,
    createdAt: LABELS_DEFINED_AT,
  },
]

/**
 * **The owner's convention, on one record** — `migrated`, and the issue id that
 * says where it went: *"they can have a convention that whenever we add the
 * migrated label, we should also have an attribute that requires a GitHub issue
 * id"*.
 *
 * It is his team's rule and **not a mechanism**: the world holds the two rows
 * independently, nothing pairs them, and `r-bullet-responses` below wears a
 * label with no value at all. That the fixture happens to show the pairing is
 * the point of a fixture — it is what a real store looks like — and the absence
 * of any enforcement is what the ruling asked for.
 *
 * A record starts with these for the reason one record starts resolved: a label
 * list is `[]` until something populates it, so a world where every record
 * started bare would let a page render the populated half however it liked and
 * never be caught — every assertion would be exercising the empty one.
 */
const OPENING_LABELS: readonly RecordLabelRow[] = [
  { retroId: RETRO_ID, rid: 'r-stale-lock', labelId: LABEL_MIGRATED, version: 1, applied: true },
  // A **retired** label, still worn. Retiring stops a label being offered, not
  // being read, so this row is what a page has to go on rendering.
  {
    retroId: RETRO_ID,
    rid: 'r-bullet-responses',
    labelId: LABEL_WONTFIX,
    version: 1,
    applied: true,
  },
]

const OPENING_ATTRIBUTE_VALUES: readonly RecordAttributeValueRow[] = [
  {
    retroId: RETRO_ID,
    rid: 'r-stale-lock',
    attributeId: ATTRIBUTE_ISSUE_ID,
    version: 1,
    value: 'https://github.com/haiderhameed/retro/issues/91',
  },
  // A value for an attribute nobody offers any more — the same case the retired
  // label above is, one table over, and the reason a value carries `retired` at
  // all.
  {
    retroId: RETRO_ID,
    rid: 'r-stale-lock',
    attributeId: ATTRIBUTE_STORY_POINTS,
    version: 1,
    value: '5',
  },
]

/**
 * The relation the world opens holding — **authored by the AI**, which is the
 * actor the feature exists for: *"so that AI can easily find past records and
 * build holistic solutions."*
 *
 * A record starts with one for `OPENING_LABELS`' reason: a relations list is
 * `[]` until something populates it, so a world where every record started
 * unrelated would let a page render the populated half however it liked and
 * never be caught — every assertion would be exercising the empty one. It also
 * gives a scenario an AI-written relation to read on **both** records' pages
 * without the browser writing one, which the browser could not do: the context
 * actor is `human` unconditionally.
 *
 * It is expressed as a pair of `(retroId, rid)` addresses and resolved to global
 * ids when the world opens, rather than written as two numbers. The numbers are
 * derived from the whole world — which retrospectives exist and in what order —
 * so a literal here would be a fixture asserting itself
 * (`r-mock-world-semantics`, and the reason `RecordIdRow` is minted rather than
 * seeded).
 */
const OPENING_RELATIONS: readonly {
  readonly from: string
  readonly to: string
  readonly how: string
  readonly actor: NonNullable<Lifecycle['actor']>
}[] = [
  {
    from: 'r-silent-tailer',
    to: 'r-stale-lock',
    how: 'the same swallowed error, one loop further out',
    actor: 'ai',
  },
]

/* ── the world ────────────────────────────────────────────────────────────── */

type World = {
  /**
   * Every retrospective on the stage, oldest first — the order they were
   * started, which is the order "Retro #n" counts in. `retros[0]` is the one
   * under review and the only one every page other than `/records` is about.
   */
  retros: Retrospective[]
  /** The global sequence, in minting order — `recordIds[n - 1].id` is always `n`. */
  recordIds: RecordIdRow[]
  decisions: DecisionRow[]
  threads: ThreadRow[]
  resolutions: ResolutionRow[]
  /**
   * The word the human left on each round he left one on
   * (`r-finish-confirm-message`) — the round's own human field, keyed by
   * revision exactly as the table is. It is not a thread and not a comment: the
   * owner asked for it *"delivered separately from the comments"*.
   */
  finishMessages: FinishMessageRow[]
  /** What has been done about each record since the review closed. */
  lifecycle: LifecycleRow[]
  /**
   * The two vocabularies — **global**, which is why they hang off the world
   * rather than off a retrospective, and why the page that manages them is
   * `/settings` (the owner: *"each label or attribute is going to be a global
   * thing"*).
   *
   * They are `LabelDefinition`/`AttributeDefinition` rather than a seed type,
   * because a definition on the wire *is* the row: there is nothing the store
   * keeps about one that the settings page does not read.
   */
  labelDefinitions: LabelDefinition[]
  attributeDefinitions: AttributeDefinition[]
  recordLabels: RecordLabelRow[]
  recordAttributeValues: RecordAttributeValueRow[]
  /**
   * Which records somebody said belong together. Off the world rather than off a
   * retrospective, because a relation belongs to none — it is the one thing here
   * that deliberately crosses them.
   */
  recordRelations: RecordRelationRow[]
  /**
   * Whether the human has granted the AI the ability to write definitions —
   * OWNER RULING 2's toggle, as a boolean because that is the whole of what the
   * wire carries.
   *
   * The store keeps a **version per act** and the history is the point of the
   * table there; nothing on the settings page renders one, so the wire does not
   * carry it and this world does not model it. What would be dishonest is the
   * other direction — canning `aiConfigWrite: false` into the answer while the
   * page's own switch wrote nothing.
   *
   * **The guard the toggle governs is not modelled, and cannot be**: the
   * browser's context actor is `human` unconditionally, so no procedure a page
   * can call is ever refused by it. That refusal is the AI's, in its own
   * process, and it is proved where it lives — `packages/core/test/unit/
   * settings.test.ts`. The same reasoning keeps `records.setLifecycle`'s
   * human-only acts unmodelled here.
   */
  aiConfigWrite: boolean
  events: WireEvent[]
  nextId: number
  /**
   * When the next write happens, in epoch milliseconds — the world's clock.
   *
   * On the world rather than in a module-level `let`, so a fresh world starts a
   * fresh clock: `initialWorld()` runs on every load and every scenario is
   * entitled to the same timestamps as the one before it.
   */
  nextWriteMs: number
}

type FinishMessageRow = {
  readonly retroId: number
  readonly revision: number
  readonly message: string
}

/**
 * Both fixture threads were written at `FIXED_TIME`, which is revision 1's
 * `createdAt`, so `revision: 1` is what this world *is* rather than a number
 * canned to satisfy an assertion — the same standing as `retroNumber: 1`. Every
 * message written during a scenario derives its revision from how much the retro
 * has filed, the way the server derives it from the revision the page names or
 * the latest one.
 */
const RECORD_THREAD: ThreadRow = {
  retroId: RETRO_ID,
  id: 1,
  rid: 'r-bullet-responses',
  section: 'direction',
  openedAt: FIXED_TIME,
  messages: [
    {
      id: 1,
      actor: 'human',
      text: 'Complete sentences, but keep dropping detail — I do not want longer answers.',
      at: FIXED_TIME,
      revision: 1,
    },
    {
      id: 2,
      actor: 'ai',
      text: 'Understood: prose, same budget, fewer things said.',
      at: FIXED_TIME,
      revision: 1,
    },
  ],
}

/**
 * A thread about the review rather than about any record — the shape that had a
 * write path and no read path until `r-retro-level-comments`, which is most of
 * why the owner's asks went in under a record instead.
 *
 * It carries both actors, because the panel renders whoever wrote a message and
 * the AI's half arrives from a different process entirely.
 */
const REVIEW_THREAD: ThreadRow = {
  retroId: RETRO_ID,
  id: 2,
  rid: null,
  section: null,
  openedAt: FIXED_TIME,
  messages: [
    {
      id: 3,
      actor: 'human',
      text: 'Three records this round is fewer than the session earned.',
      at: FIXED_TIME,
      revision: 1,
    },
    {
      id: 4,
      actor: 'ai',
      text: 'Two more are drafted; they did not clear the bar for a record.',
      at: FIXED_TIME,
      revision: 1,
    },
  ],
}

/**
 * Whether this page was opened on a retrospective **nobody has commented on at
 * all** — the state every retrospective is in until someone writes the first
 * comment, and the one the comments panel has nothing to show in.
 *
 * It emptied the *review's* threads and left the record's until session 7, when
 * `threads.list` stopped filtering to review-level threads (the owner: *"This
 * enables human to see all comments in one place"*). A record thread is
 * something the panel shows now, so a world that kept one would not be a world
 * with an empty panel — and every scenario that sets this flag is about the
 * empty panel.
 *
 * It is arranged rather than performed, and it has to be: threads are
 * append-only (D4), so there is no act in the product that empties them. A
 * scenario sets the flag before the app boots (`page.addInitScript`) and the
 * fixture reads it once, here. Nothing under `apps/web/src` knows it exists and
 * it changes no procedure's behaviour — only which rows the world starts with,
 * the way `REVISIONS_ALREADY_FILED` does.
 */
function bareReview(): boolean {
  return typeof window !== 'undefined' && window.retroMockBareReview === true
}

/**
 * Whether this page was opened on a **fresh install** — the AI has filed
 * nothing, so no retrospective exists (retro 3 `r-untested-rendered-branch`).
 *
 * `createRevision` is what starts a retrospective and writes revision 1, in one
 * unit of work, and nothing else can start one. So "no revisions filed" is not
 * a separate switch: it *is* the empty product, and this flag says it by
 * starting the world's revision counter at zero rather than at two. The
 * procedures below read `world.filed` and answer accordingly, exactly as they
 * already do when `fileRevision()` moves it the other way.
 *
 * Arranged rather than performed, and it has to be: nothing deletes a
 * retrospective, so no act in the product takes a store back to empty. The
 * scenario sets the flag before the app boots and the fixture reads it once,
 * the way `bareReview` above does.
 */
function freshInstall(): boolean {
  return typeof window !== 'undefined' && window.retroMockFreshInstall === true
}

/**
 * Whether this page was opened on a store that carries a **`hold` verdict** —
 * the fourth `DecisionState`, which stopped being writable in retro 3
 * `r-hold-semantics`.
 *
 * Arranged rather than performed, and it has to be: no write path in the product
 * can produce one, which is the whole point of the state. It is a real row of a
 * real shape all the same — `DecisionRow` already types `state` from the wire
 * enum, so this is the world modelling a value it can hold rather than a literal
 * canned into an answer. `effectiveDecision` resolves it exactly as it resolves
 * any other verdict, the counts follow, and the filter bar decides for itself
 * whether the chip belongs.
 *
 * It is decided against revision 2 — the revision a scenario opens on — so the
 * verdict binds rather than reading as carried over from an earlier draft.
 */
function legacyHoldVerdict(): boolean {
  return typeof window !== 'undefined' && window.retroMockLegacyHoldVerdict === true
}

const LEGACY_HOLD_DECISION: DecisionRow = {
  retroId: RETRO_ID,
  rid: 'r-stale-lock',
  revision: REVISIONS_ALREADY_FILED,
  at: SECOND_REVISION_TIME,
  state: 'hold',
  severity: 2,
  solutionLevel: 2,
  // Null the way every decision row written before solutions existed is: nobody
  // asked this reviewer which one, so the effective view falls back to the
  // recommendation, which is what he was in fact shown.
  selectedSolution: null,
  involvement: 'pull-request',
  reviewerNote: 'Parked, under the model retro 3 replaced.',
}

/**
 * Whether this page was opened on a stage holding **more than one
 * retrospective** — a second one in the same session, and a third in a different
 * session in a different working directory, both already closed.
 *
 * Arranged rather than performed, like the three flags above it, and for the
 * same reason: nothing a browser can do starts a retrospective, let alone one in
 * another session and another checkout. `createRevision` starts them and the AI
 * runs it from wherever it is working.
 *
 * **Why it exists at all**, when `records.listAll` says a second fixture retro
 * would only re-prove ordering: because ordering is not what the *page* can get
 * wrong. Ordering is proved against the real router and stays proved there. What
 * only a browser can answer is whether each row carries **its own**
 * retrospective's identity line, links to **its own** retrospective, and
 * addresses **its own** `(retroId, rid)` when the human resolves it — and a
 * world with one retrospective in it answers every one of those questions the
 * same way whether the page is right or wrong. `/records` is the only surface in
 * the product that holds rows from several retrospectives at once, so it is the
 * only one where those three can fail.
 *
 * **Behind a flag** so that every scenario that does not ask for it sees the
 * world it has always seen: `dashboard.feature` asserts the list is one row, and
 * the review page's fixture is this one retrospective. A scenario about the flat
 * page sets this before the app boots; nothing under `apps/web/src` knows it
 * exists, and it changes no procedure's behaviour — only which retrospectives
 * the world starts with.
 *
 * **Outside a browser it is always on**, and that is not the flag leaking. There
 * are no scenarios out there and nothing to choose between worlds; there is one
 * reader, `scripts/check-mock-parity.ts`, and its whole job is to hand every
 * answer this module can produce to the schema the real router validates that
 * answer with. Left off, the closed retrospectives' rows would be the one part
 * of the world no strict schema ever saw — a second retrospective's row could
 * carry a field the router would refuse and nothing would say so. The wider
 * world is the stricter check, so the check gets the wider world.
 */
function crossRetro(): boolean {
  if (typeof window === 'undefined') return true
  return window.retroMockCrossRetro === true
}

/**
 * Whether this page was opened on a store whose **vocabulary nobody has
 * configured** — no labels, no attributes, and therefore nothing on any record.
 *
 * It is the state every store is in between the AI filing its first
 * retrospective and a human first opening `/settings`, and it is the state three
 * rendered branches only exist for: the settings page's "none yet", the record
 * page's "create them on the settings page", and the records filter having no
 * label group at all (`r-untested-rendered-branch`).
 *
 * Arranged rather than performed, like the four flags above it, and here the
 * reason is the strongest of the five: **nothing deletes a definition.** Retiring
 * is what this product does instead, and a retired label is still on the list —
 * so there is no sequence of acts in the product that takes a configured store
 * back to an unconfigured one.
 *
 * It is **not** folded into `freshInstall`. That flag says the AI has filed
 * nothing, which empties the retrospectives; this one says the human has
 * configured nothing, which empties the vocabularies. A store can be in either
 * without the other, and the record page's empty branch needs a record to stand
 * on — so it needs exactly this one and not that one.
 */
function bareVocabulary(): boolean {
  return typeof window !== 'undefined' && window.retroMockBareVocabulary === true
}

/** The retrospective under review, which every world has. */
function retroUnderReview(): Retrospective {
  return {
    retroId: RETRO_ID,
    retroNumber: 1,
    session: { id: SESSION_ID, cwd: CWD, startedAt: FIXED_TIME },
    project: PROJECT,
    startedAt: FIXED_TIME,
    revisions: REVISIONS,
    filed: freshInstall() ? 0 : REVISIONS_ALREADY_FILED,
    state: 'reviewing',
    finishedAt: null,
  }
}

/**
 * The two closed ones, in the order they were started — which is the order
 * "Retro #n" counts in, per session. So the second retrospective of session 1 is
 * "Retro #2" and the first of session 2 is "Retro #1", and the three identity
 * lines on the page differ in both halves rather than only in the number.
 */
function retrosAlreadyClosed(): Retrospective[] {
  return [
    {
      retroId: SECOND_RETRO_ID,
      retroNumber: 2,
      session: { id: SESSION_ID, cwd: CWD, startedAt: FIXED_TIME },
      project: PROJECT,
      startedAt: SECOND_RETRO_TIME,
      revisions: SECOND_RETRO_REVISIONS,
      filed: SECOND_RETRO_REVISIONS.length,
      state: 'finished',
      finishedAt: SECOND_RETRO_TIME,
    },
    {
      retroId: THIRD_RETRO_ID,
      retroNumber: 1,
      session: { id: SECOND_SESSION_ID, cwd: SECOND_CWD, startedAt: THIRD_RETRO_TIME },
      project: null,
      startedAt: THIRD_RETRO_TIME,
      revisions: THIRD_RETRO_REVISIONS,
      filed: THIRD_RETRO_REVISIONS.length,
      state: 'finished',
      finishedAt: THIRD_RETRO_TIME,
    },
  ]
}

/**
 * Mints a number for every record of `revisions` the retrospective has not seen,
 * in the order the server would: revision by revision, `num` ascending inside
 * one, skipping a rid that already has a row.
 *
 * It appends to `rows`, so the sequence runs across retrospectives — which is the
 * whole of the change, and the reason a record of retro 3 is `#6` here while its
 * own retrospective still calls it record 1.
 */
function mintRecordIds(
  rows: RecordIdRow[],
  retro: Retrospective,
  revisions: readonly Revision[],
): void {
  const seen = new Set(rows.filter((row) => row.retroId === retro.retroId).map((row) => row.rid))
  for (const revision of revisions) {
    for (const record of [...revision.records].sort((left, right) => left.num - right.num)) {
      if (seen.has(record.rid)) continue
      seen.add(record.rid)
      rows.push({ id: rows.length + 1, retroId: retro.retroId, rid: record.rid })
    }
  }
}

/**
 * The opening relations, with each side's address turned into the number the
 * store would have minted for it — and skipped where the world does not hold the
 * record, which is what keeps one seed honest across every fixture arrangement.
 */
function openingRelations(rows: readonly RecordIdRow[]): RecordRelationRow[] {
  const numberOf = (rid: string) =>
    rows.find((row) => row.retroId === RETRO_ID && row.rid === rid)?.id
  const relations: RecordRelationRow[] = []
  for (const seed of OPENING_RELATIONS) {
    const fromId = numberOf(seed.from)
    const toId = numberOf(seed.to)
    if (fromId === undefined || toId === undefined) continue
    relations.push({
      seq: relations.length + 1,
      fromId,
      toId,
      version: 1,
      applied: true,
      how: seed.how,
      actor: seed.actor,
      at: WORLD_OPENS,
    })
  }
  return relations
}

function initialWorld(): World {
  const bare = bareReview()
  const bare2 = bareVocabulary()
  const wide = crossRetro() && !freshInstall()

  const retros = [retroUnderReview(), ...(wide ? retrosAlreadyClosed() : [])]
  // The migration's own pass, over the world as it opens: retrospectives in id
  // order — which is the order they are held in — and only what has been filed,
  // because a revision the AI has not filed yet does not exist.
  const recordIds: RecordIdRow[] = []
  for (const retro of retros) mintRecordIds(recordIds, retro, revisionsFiled(retro))

  return {
    retros,
    recordIds,
    decisions: [
      ...(legacyHoldVerdict() ? [LEGACY_HOLD_DECISION] : []),
      ...(wide ? CLOSED_DECISIONS : []),
    ],
    threads: bare ? [] : [RECORD_THREAD, REVIEW_THREAD],
    resolutions: [],
    finishMessages: [],
    lifecycle: wide ? [...CLOSED_LIFECYCLE] : [],
    // The vocabularies are not behind `crossRetro`: they are global, so they are
    // the same list whichever retrospectives the world holds. `bareVocabulary`
    // is the one arrangement that empties them, and it empties what records wear
    // with them — a row cannot point at a definition that is not there.
    labelDefinitions: bare2 ? [] : [...LABEL_DEFINITIONS],
    attributeDefinitions: bare2 ? [] : [...ATTRIBUTE_DEFINITIONS],
    recordLabels: bare2 ? [] : [...OPENING_LABELS],
    recordAttributeValues: bare2 ? [] : [...OPENING_ATTRIBUTE_VALUES],
    /**
     * Not behind `bareVocabulary`: a relation points at no definition, so an
     * unconfigured store still holds every relation anybody wrote. It **is**
     * behind `bareReview`, because that world has filed nothing for a relation
     * to be about, and the addresses below would resolve to nothing.
     */
    recordRelations: bare ? [] : openingRelations(recordIds),
    // Off, which is what a store nobody has configured is — and the state the
    // owner asked a fresh install to be in.
    aiConfigWrite: false,
    events: [],
    nextId: 100,
    nextWriteMs: new Date(WORLD_OPENS).getTime(),
  }
}

/**
 * The moment of the write about to happen, and the clock moved on.
 *
 * Called by the two write paths whose rows the record page's timeline reads —
 * a verdict and a lifecycle act. Comments are not among them: nothing renders a
 * message's moment, so `FIXED_TIME` is still the honest answer there and moving
 * it would be churn in the one shape a dozen scenarios already read.
 */
function stamp(): string {
  const at = new Date(world.nextWriteMs).toISOString()
  world.nextWriteMs += WRITE_STEP_MS
  return at
}

let world = initialWorld()

/* ── errors, shaped the way the real error map shapes them ────────────────── */

const JSONRPC = {
  BAD_REQUEST: -32600,
  NOT_FOUND: -32004,
  CONFLICT: -32009,
  PRECONDITION_FAILED: -32012,
} as const
const HTTP = { BAD_REQUEST: 400, NOT_FOUND: 404, CONFLICT: 409, PRECONDITION_FAILED: 412 } as const

type FailureCode = keyof typeof JSONRPC

/**
 * `trpc.md` §Error map, from the browser's side. The finish gate is the one that
 * carries a payload: refusing to finish is only useful if the page can name the
 * records it refused over, so `pendingRids` rides in `data` exactly as the
 * server's `errorFormatter` puts it there.
 */
function failure(
  code: FailureCode,
  message: string,
  extra?: { readonly pendingRids: readonly string[] },
): TRPCClientError<AppRouter> {
  return new TRPCClientError(message, {
    result: {
      error: {
        message,
        code: JSONRPC[code],
        data: { code, httpStatus: HTTP[code], ...extra },
      },
    },
  })
}

/* ── the rules the server also applies ────────────────────────────────────── */

/** The retrospective every act of the AI's is about: the one under review. */
function underReview(): Retrospective {
  const retro = world.retros[0]
  if (retro === undefined) throw new Error('the world has no retrospective')
  return retro
}

function revisionsFiled(retro: Retrospective): readonly Revision[] {
  return retro.revisions.slice(0, retro.filed)
}

function latestRevisionN(retro: Retrospective): number {
  return retro.filed
}

/** The retro's name: the latest filed revision's, null when it proposed none. */
function latestTitle(retro: Retrospective): string | null {
  return revisionsFiled(retro).at(-1)?.title ?? null
}

function revisionAt(retro: Retrospective, n: number): Revision {
  const revision = revisionsFiled(retro).find((candidate) => candidate.n === n)
  if (revision === undefined) {
    throw failure('NOT_FOUND', `No revision ${n} of retrospective ${retro.retroId}`)
  }
  return revision
}

/**
 * The retrospective a procedure was addressed to, or NOT_FOUND.
 *
 * A retrospective exists once a revision has been filed against it, and not
 * before — `createRevision` starts it. So a world with nothing filed answers
 * NOT_FOUND to every retro-addressed procedure, the way the real server would.
 *
 * It **returns** the retrospective rather than only checking it, because every
 * caller then works against the one it was addressed to. That is the whole
 * safety of holding more than one: a procedure cannot answer for retro 1 while
 * a page asked about retro 3, because there is no ambient retrospective left to
 * fall back to.
 */
function requireRetro(retroId: number): Retrospective {
  const retro = world.retros.find((candidate) => candidate.retroId === retroId)
  if (retro === undefined || retro.filed === 0) {
    throw failure('NOT_FOUND', `No retrospective with id ${retroId}`)
  }
  return retro
}

function narrativeAt(revision: Revision, rid: string): RecordSeed {
  const record = revision.records.find((candidate) => candidate.rid === rid)
  if (record === undefined) {
    throw failure('NOT_FOUND', `No record ${rid} in revision ${revision.n}`)
  }
  return record
}

/** The content hash, in the only form a browser needs: identical or not. */
function contentOf(record: RecordSeed): string {
  const { rid: _rid, num: _num, proposed: _proposed, ...content } = record
  return JSON.stringify(content)
}

/** Every verdict ever given on one record, oldest first — its position is its version. */
function decisionsFor(retroId: number, rid: string): DecisionRow[] {
  return world.decisions.filter((row) => row.retroId === retroId && row.rid === rid)
}

function latestDecisionFor(retroId: number, rid: string): DecisionRow | undefined {
  return decisionsFor(retroId, rid).at(-1)
}

/**
 * Which solution the AI recommends, 1-based — the number the page prints in
 * "Solution 2", and null on a record that proposes none.
 *
 * Modelled rather than canned: the mock world is stateful, and a field it does
 * not model must not be a constant somebody typed (`r-mock-world-semantics`).
 * This is the fallback the server applies when a verdict says nothing about the
 * selection, so a scenario that presses a verdict without touching the
 * solutions is exercising the real rule.
 */
function recommendedSolution(record: RecordSeed): number | null {
  if (record.solutions === null) return null
  const index = record.solutions.findIndex((solution) => solution.recommended)
  return index === -1 ? 1 : index + 1
}

/**
 * The level the AI proposes, derived the way the server derives it
 * (`proposedLevel` in `record.model.ts`, via `records.router.ts`): the field the
 * draft authored on a record filed before solutions, the **recommended
 * solution's** level on one filed after.
 *
 * Derived rather than carried on the fixture, and the distinction is the module
 * header's own rule. A record with solutions stores no level anywhere on the
 * server — it is purely a function of that array — so a literal here would be a
 * second authored copy of a judgment, free to disagree with the array it claims
 * to summarise the moment somebody moves the `recommended` flag. The fixture
 * says what the AI wrote; this says what the server would compute from it.
 */
function proposedLevel(record: RecordSeed): Decision['solutionLevel'] {
  const authored = record.proposed.solutionLevel
  const selected = recommendedSolution(record)
  if (record.solutions === null || selected === null) return authored ?? 'undecided'
  return record.solutions[selected - 1]?.level ?? 1
}

/**
 * "Which solution, and therefore which level" — one answer, the way
 * `RecordDecisionUseCase` resolves it.
 *
 * On a record with solutions the level *is* the selected solution's, and the
 * selection falls back `input ?? previous ?? recommended`. On a record without
 * them the level is the dial the human turns and there is nothing to select.
 */
function chooseSolution(
  record: RecordSeed,
  input: Pick<InputOf<'decisions.record'>, 'solutionLevel' | 'selectedSolution'>,
  previous: DecisionRow | undefined,
): Pick<DecisionRow, 'solutionLevel' | 'selectedSolution'> {
  const solutions = record.solutions
  if (solutions === null) {
    // The mirror image of the refusal below: a record that proposes nothing to
    // choose between takes no choice (`record-decision.use-case.ts`).
    if (input.selectedSolution !== undefined) {
      throw failure('BAD_REQUEST', `record ${record.rid} proposes no solutions to select between`)
    }
    return {
      solutionLevel: input.solutionLevel ?? previous?.solutionLevel ?? proposedLevel(record),
      selectedSolution: null,
    }
  }

  /**
   * The three refusals the server raises, mirrored here — **not** because the
   * page is expected to send one, but because the page's guards against sending
   * one are only falsifiable if the wrong payload is answered differently from
   * the right one. A mock that quietly dropped `solutionLevel` here made
   * `hasSolutions ||` in `decision-controls.tsx` unfalsifiable: deleting the
   * guard produced a byte-identical answer, so no scenario could catch a change
   * that the real server answers with BAD_REQUEST and a lost verdict.
   */
  if (input.solutionLevel !== undefined) {
    throw failure(
      'BAD_REQUEST',
      `the level of record ${record.rid} is the level of the solution selected; send selectedSolution instead`,
    )
  }
  if (input.selectedSolution !== undefined && input.selectedSolution > solutions.length) {
    throw failure(
      'BAD_REQUEST',
      `record ${record.rid} proposes ${solutions.length} solution(s); ${input.selectedSolution} is not one of them`,
    )
  }

  const carried =
    previous?.selectedSolution !== null &&
    previous?.selectedSolution !== undefined &&
    previous.selectedSolution <= solutions.length
      ? previous.selectedSolution
      : null
  const selected = input.selectedSolution ?? carried ?? (recommendedSolution(record) as number)
  return {
    solutionLevel: solutions[selected - 1]?.level ?? proposedLevel(record),
    selectedSolution: selected,
  }
}

/**
 * `effectiveDecision` from core, restated over the wire shapes: a verdict binds
 * to the content it was given for. Identical content carries it forward;
 * changed content sends the record back to pending without writing anything,
 * because pending is the *absence* of a decision for what is on screen (D2).
 */
function effectiveDecision(
  retro: Retrospective,
  record: RecordSeed,
  shownRevision: number,
): Decision {
  const proposed: Decision = {
    state: 'pending',
    decidedOnRevision: null,
    carriedOver: false,
    contentChangedSince: null,
    severity: record.proposed.severity,
    solutionLevel: proposedLevel(record),
    // While a record is pending, what shows is the AI's recommendation — the
    // same shape the three dials have.
    selectedSolution: recommendedSolution(record),
    involvement: record.proposed.involvement,
    reviewerNote: null,
  }

  const latest = latestDecisionFor(retro.retroId, record.rid)
  if (latest === undefined) return proposed

  const decidedAgainst = narrativeAt(revisionAt(retro, latest.revision), record.rid)
  if (contentOf(decidedAgainst) !== contentOf(record)) {
    return { ...proposed, contentChangedSince: latest.revision }
  }

  return {
    state: latest.state,
    decidedOnRevision: latest.revision,
    carriedOver: latest.revision !== shownRevision,
    contentChangedSince: null,
    severity: latest.severity,
    solutionLevel: latest.solutionLevel,
    selectedSolution: latest.selectedSolution ?? recommendedSolution(record),
    involvement: latest.involvement,
    reviewerNote: latest.reviewerNote,
  }
}

/**
 * The number a record shows — its row in the global sequence.
 *
 * It shouts rather than falling back, the way `requireGlobalId` does in core: a
 * record with no row is a world the fixture built wrong, and a `#undefined` on a
 * page is a scenario failing three assertions later with nothing to say about
 * why.
 */
function globalIdOf(retroId: number, rid: string): number {
  const minted = world.recordIds.find((row) => row.retroId === retroId && row.rid === rid)
  if (minted === undefined) {
    throw new Error(`record ${rid} of retrospective ${retroId} has no global number`)
  }
  return minted.id
}

/**
 * A record, whole — the shape `records.get` and `records.byId` both answer with.
 *
 * One function for both, because the server builds both from one
 * (`wire.ts` §toWireRecordDetail) and a mock that built them separately could
 * let the two pages disagree about what a record is while the real server never
 * would. It is also the one place a seed becomes the wire shape:
 * `proposed.solutionLevel` is derived here, exactly as `records.router.ts`
 * derives it, so the page reads what the server would have sent rather than what
 * a fixture said.
 */
function detailOf(retro: Retrospective, revision: Revision, record: RecordSeed): RecordDetail {
  return {
    retroId: retro.retroId,
    revision: revision.n,
    // Beside the narrative and not inside it, as the router has it: `record`
    // below is the draft the AI submitted, and this is the one name on a record
    // the AI does not author.
    globalId: globalIdOf(retro.retroId, record.rid),
    record: { ...record, proposed: { ...record.proposed, solutionLevel: proposedLevel(record) } },
    decision: effectiveDecision(retro, record, revision.n),
    // Beside the narrative and not inside it, as the router has it: the record
    // is the draft the AI submitted, and a label is something a human put on it
    // afterwards.
    labels: labelsOf(retro.retroId, record.rid),
  }
}

function summarise(retro: Retrospective, record: RecordSeed, shownRevision: number): RecordSummary {
  const decision = effectiveDecision(retro, record, shownRevision)
  return {
    rid: record.rid,
    globalId: globalIdOf(retro.retroId, record.rid),
    num: record.num,
    title: record.title,
    type: record.type,
    requester: record.requester,
    state: decision.state,
    decidedOnRevision: decision.decidedOnRevision,
    carriedOver: decision.carriedOver,
    contentChangedSince: decision.contentChangedSince,
    // The same lifecycle `records.listAll` answers with, from the same helper
    // and the same rows — a record does not stand in two places at once.
    lifecycle: lifecycleOf(retro, record),
  }
}

/**
 * **When** the human finished this round, or null while they have not
 * (`r-finish-button-reenables`).
 *
 * Derived from the world's own `ReviewFinished` events, exactly as the store
 * derives it — the CLI's `review wait` answers the same question from the same
 * rows. It is modelled rather than canned on purpose: a fixed string here would
 * make the reload scenario assert against a constant this module wrote, and the
 * scenario is about the page reading back a fact the *press* created
 * (`r-mock-world-semantics`: a field the world does not model must not be
 * canned).
 *
 * The first press is the one that counts. A second is absorbed rather than
 * refused, so it must not move the moment the round was finished at.
 */
function finishedAtOf(retro: Retrospective, revision: number): string | null {
  return (
    world.events.find(
      (event) =>
        event.name === 'ReviewFinished' &&
        event.retroId === retro.retroId &&
        event.revisionN === revision,
    )?.at ?? null
  )
}

/** Whether the human has already finished this round — one press per revision. */
function finishedRound(retro: Retrospective, revision: number): boolean {
  return finishedAtOf(retro, revision) !== null
}

/**
 * The state a reader is shown this retrospective is in, derived the way the
 * server derives it (`retro.view.ts`): `submitted` is `reviewing` **and** the
 * human has finished the latest round.
 *
 * One function, used by every procedure that reports a retrospective's state,
 * for the reason the product has one `RetroStateTag`: a mock whose dashboard
 * row and review page could answer differently would let a scenario prove an
 * agreement the product does not have.
 */
function displayStateOf(retro: Retrospective): RetroState {
  if (retro.state !== 'reviewing') return retro.state
  return finishedRound(retro, latestRevisionN(retro)) ? 'submitted' : 'reviewing'
}

function pendingRids(retro: Retrospective): readonly string[] {
  const revision = revisionAt(retro, latestRevisionN(retro))
  return revision.records
    .filter((record) => effectiveDecision(retro, record, revision.n).state === 'pending')
    .map((record) => record.rid)
}

function threadsFor(retroId: number, rid: string): ThreadRow[] {
  return world.threads.filter((thread) => thread.retroId === retroId && thread.rid === rid)
}

/** The review's own threads: the ones anchored to no record. */
function reviewThreads(retroId: number): ThreadRow[] {
  return world.threads.filter((thread) => thread.retroId === retroId && thread.rid === null)
}

function replaceThread(thread: ThreadRow): ThreadRow {
  world.threads = world.threads.map((candidate) =>
    candidate.id === thread.id ? thread : candidate,
  )
  return thread
}

/**
 * Whether the human has settled a thread: the latest resolution row's value, and
 * `false` when he has never touched it — the effective read the server computes
 * from the highest version (`r-resolvable-comments`).
 */
function resolvedOf(threadId: number): boolean {
  return world.resolutions.filter((row) => row.threadId === threadId).at(-1)?.resolved ?? false
}

/**
 * Store row → wire: the derived `resolved` goes on, and the `retroId` column
 * comes off. Every thread procedure is addressed to a retrospective already, so
 * the wire never carries one back — and `threadSchema` is strict, which is what
 * turns leaving it on into a failed build rather than an extra field nobody
 * notices.
 */
function toWireThread(thread: ThreadRow): Thread {
  const { retroId: _retroId, ...wire } = thread
  return { ...wire, resolved: resolvedOf(thread.id) }
}

/**
 * Where each act leaves the record, and which act may be taken from where —
 * `record-lifecycle.service.ts` in core, restated over the wire shapes. They are
 * one table each here for the same reason they are there: a chain of ternaries
 * is a place for a fifth act to be forgotten.
 */
const STATE_AFTER: Record<LifecycleRow['status'], Lifecycle['status']> = {
  resolved: 'resolved',
  reopened: 'open',
  archived: 'archived',
  unarchived: 'open',
}

const ACT_FROM: Record<LifecycleRow['status'], readonly Lifecycle['status'][]> = {
  resolved: ['open'],
  reopened: ['resolved'],
  archived: ['open', 'resolved'],
  unarchived: ['archived'],
}

/** One event name per act, exactly as the outbox carries them. */
const EVENT_OF_ACT: Record<LifecycleRow['status'], WireEvent['name']> = {
  resolved: 'RecordResolved',
  reopened: 'RecordReopened',
  archived: 'RecordArchived',
  unarchived: 'RecordUnarchived',
}

/**
 * Where a record stands on the lifecycle axis: the latest entry read as a state,
 * and — when there is none — the verdict read as one.
 *
 * `open` for an untouched record is the safe half of the inference this feature
 * makes: it reads silence about *acts* as nothing having been done. The one
 * exception is a **declined** record, which is `archived` from birth with no row
 * anywhere (the owner's session-9 ruling): that is a reading of something he
 * explicitly decided, and it is derived here rather than seeded, so a scenario
 * that declines a record watches it move.
 */
function lifecycleOf(retro: Retrospective, record: RecordSeed): Lifecycle {
  const latest = lifecycleFor(retro.retroId, record.rid).at(-1)
  if (latest === undefined) {
    const verdict = effectiveDecision(retro, record, latestRevisionN(retro)).state
    return {
      status: verdict === 'declined' ? 'archived' : 'open',
      refs: [],
      note: null,
      actor: null,
      at: null,
    }
  }

  return {
    status: STATE_AFTER[latest.status],
    // Empty on anything but a resolve: the refs of the resolve an act superseded
    // are history, not the state of the record the act left behind.
    refs: [...latest.refs],
    note: latest.note,
    actor: latest.actor,
    at: latest.at,
  }
}

/**
 * The pairing rule the server enforces, mirrored — **not** because the page is
 * expected to send a bad payload, but because a page's guard against sending one
 * is only falsifiable if the wrong payload is answered differently from the
 * right one (`chooseSolution` above, same reasoning).
 *
 * A resolve cites at least one reference, because the evidence is the point of
 * the feature; nothing else cites any, because refs are present exactly when a
 * record is resolved. References are trimmed and a whitespace-only one is
 * refused rather than dropped.
 */
function lifecycleRefs(input: InputOf<'records.setLifecycle'>): readonly string[] {
  const refs = (input.refs ?? []).map((ref) => ref.trim())

  if (input.status === 'resolved') {
    if (refs.length === 0) {
      throw failure('BAD_REQUEST', 'resolving a record needs at least one reference')
    }
    if (refs.some((ref) => ref.length === 0)) {
      throw failure('BAD_REQUEST', 'a reference must not be empty')
    }
    return refs
  }

  if (refs.length > 0) {
    throw failure('BAD_REQUEST', `${input.status} takes no references; they belong to the resolve`)
  }
  return []
}

/** Every entry written about one retrospective's record so far, oldest first. */
function lifecycleFor(retroId: number, rid: string): LifecycleRow[] {
  return world.lifecycle.filter((row) => row.retroId === retroId && row.rid === rid)
}

/**
 * One act of the lifecycle, from whichever actor took it. The router passes the
 * context's actor and the context is always `human`; the AI's half arrives
 * through `MockControl.aiResolve`, which is that act in its own process.
 *
 * The transition is checked here because the server checks it: a page that
 * offered Archive on a record already archived would be sending a payload the
 * real server refuses, and a mock that accepted it would let the page ship.
 */
function appendLifecycle(
  retro: Retrospective,
  record: RecordSeed,
  status: LifecycleRow['status'],
  refs: readonly string[],
  note: string | null,
  actor: LifecycleRow['actor'],
): Lifecycle {
  const standing = lifecycleOf(retro, record).status
  if (!ACT_FROM[status].includes(standing)) {
    throw failure(
      'CONFLICT',
      `record ${record.rid} is ${standing}, and a record can only be marked ${status} while it is ${ACT_FROM[status].join(' or ')}`,
    )
  }

  world.lifecycle.push({
    retroId: retro.retroId,
    rid: record.rid,
    status,
    refs,
    note,
    actor,
    at: stamp(),
  })
  publish(retro.retroId, EVENT_OF_ACT[status], { rid: record.rid })
  return lifecycleOf(retro, record)
}

/* ── labels and attributes, folded and joined the way the server does ─────── */

/**
 * The entry in force for one `(record, definition)` pair — what a write numbers
 * itself after, and the one read that has to see a `false` row rather than
 * skipping it: applying a label that was taken off before is version 3.
 *
 * Written once over both tables, because the rows differ only in which id they
 * carry and in what the last column holds — and a second copy would be a second
 * chance to fold one of them per record instead of per definition.
 */
function latestOf<T extends { readonly version: number }>(rows: readonly T[]): T | undefined {
  return rows.reduce<T | undefined>(
    (highest, row) => (highest === undefined || row.version > highest.version ? row : highest),
    undefined,
  )
}

function labelRows(retroId: number, rid: string, labelId?: number): RecordLabelRow[] {
  return world.recordLabels.filter(
    (row) =>
      row.retroId === retroId &&
      row.rid === rid &&
      (labelId === undefined || row.labelId === labelId),
  )
}

function attributeRows(retroId: number, rid: string, attributeId?: number) {
  return world.recordAttributeValues.filter(
    (row) =>
      row.retroId === retroId &&
      row.rid === rid &&
      (attributeId === undefined || row.attributeId === attributeId),
  )
}

/**
 * The labels a record wears, resolved against the vocabulary — the join every
 * reader of a record makes, made once here for the same reason the server makes
 * it once (`definition.view.ts`).
 *
 * **The fold is per label**, because each `(record, label)` pair has a version
 * sequence of its own; the order is the vocabulary's own minting order, which is
 * what makes a record's tags read in the same order as the settings list they
 * came from.
 */
function labelsOf(retroId: number, rid: string): RecordLabel[] {
  return world.labelDefinitions
    .filter((definition) => latestOf(labelRows(retroId, rid, definition.id))?.applied === true)
    .map((definition) => ({
      id: definition.id,
      name: definition.name,
      // Flattened to the boolean a record's reader actually asks: on a record
      // the only question is whether this is still something anyone can add.
      retired: definition.retiredAt !== null,
    }))
}

function attributesOf(retroId: number, rid: string): RecordAttribute[] {
  const carried: RecordAttribute[] = []
  for (const definition of world.attributeDefinitions) {
    const latest = latestOf(attributeRows(retroId, rid, definition.id))
    // A cleared value is a row whose value is absent, and it is dropped here
    // rather than reported as an empty string: the two are different claims.
    if (latest?.value == null) continue
    carried.push({
      id: definition.id,
      name: definition.name,
      type: definition.type,
      value: latest.value,
      retired: definition.retiredAt !== null,
    })
  }
  return carried
}

/** Every row ever written with this record on either side, oldest first. */
function relationRows(recordId: number): RecordRelationRow[] {
  return world.recordRelations.filter((row) => row.fromId === recordId || row.toId === recordId)
}

/**
 * The next row id — `MAX(seq) + 1` over the table, which is what SQLite's
 * `AUTOINCREMENT` does and, unlike a counter of its own, cannot fall behind rows
 * the world opened holding.
 */
function nextRelationSeq(): number {
  return world.recordRelations.reduce((highest, row) => Math.max(highest, row.seq), 0) + 1
}

/** The row in force for one **ordered** pair — what a write numbers itself after. */
function latestRelation(fromId: number, toId: number): RecordRelationRow | undefined {
  return latestOf(world.recordRelations.filter((row) => row.fromId === fromId && row.toId === toId))
}

/**
 * The record one global number names, or `undefined` — the store's own sequence,
 * run backwards exactly as `records.byId` runs it.
 */
function recordAt(id: number): { retro: Retrospective; record: RecordSeed } | undefined {
  const minted = world.recordIds.find((row) => row.id === id)
  if (minted === undefined) return undefined
  const retro = world.retros.find((one) => one.retroId === minted.retroId)
  if (retro === undefined) return undefined
  const record = revisionAt(retro, latestRevisionN(retro)).records.find(
    (one) => one.rid === minted.rid,
  )
  return record === undefined ? undefined : { retro, record }
}

/**
 * What a record is related to right now, both directions — the whole of *"the
 * relation reads from both sides"*, done the way the server does it: one pass
 * over rows that mention the record on either side, folded per **ordered pair**,
 * and the direction read off which column matched.
 *
 * The fold is per pair rather than per record because each pair carries a
 * version sequence of its own — a record holding three relations holds three
 * independent v1 rows — which is the same shape `labelsOf` folds one table over.
 *
 * The far record's title comes from **its own** retrospective's latest revision,
 * never the page's: a relation crosses retrospectives, and reading a title out
 * of the wrong one is exactly the mistake keying by rid alone would make. A
 * record a later draft withdrew falls back to its rid, which is the name it
 * still has.
 */
function relationsOf(recordId: number): OutputOf<'records.byId'>['relations'] {
  const inForce = new Map<string, RecordRelationRow>()
  for (const row of relationRows(recordId)) {
    const key = `${row.fromId} ${row.toId}`
    const known = inForce.get(key)
    if (known === undefined || row.version > known.version) inForce.set(key, row)
  }

  const relations: OutputOf<'records.byId'>['relations'][number][] = []
  /**
   * **Sorted by the row in force, never by the map's insertion order** — the sort
   * the server makes over the same rows. Insertion order is the order each
   * *pair* was first written, which is a different question and stops being the
   * same answer the moment an old pair is un-related and related again.
   */
  const standing = [...inForce.values()]
    .filter((one) => one.applied)
    .sort((left, right) => left.seq - right.seq)
  for (const row of standing) {
    const outgoing = row.fromId === recordId
    const otherId = outgoing ? row.toId : row.fromId
    const other = world.recordIds.find((one) => one.id === otherId)
    if (other === undefined) continue
    relations.push({
      globalId: otherId,
      title: recordAt(otherId)?.record.title ?? other.rid,
      how: row.how,
      direction: outgoing ? 'outgoing' : 'incoming',
      actor: row.actor,
      at: row.at,
    })
  }
  return relations
}

/** The definition a procedure was addressed to, or NOT_FOUND. */
function requireLabel(id: number): LabelDefinition {
  const definition = world.labelDefinitions.find((one) => one.id === id)
  if (definition === undefined) throw failure('NOT_FOUND', `No label with id ${id}`)
  return definition
}

function requireAttribute(id: number): AttributeDefinition {
  const definition = world.attributeDefinitions.find((one) => one.id === id)
  if (definition === undefined) throw failure('NOT_FOUND', `No attribute with id ${id}`)
  return definition
}

/**
 * The name rules the server applies, mirrored — **not** because the settings
 * page is expected to send a bad one, but because a page's guard against
 * sending one is only falsifiable if the wrong payload is answered differently
 * from the right one (the same reasoning `chooseSolution` and `lifecycleRefs`
 * give above).
 *
 * Trimmed, non-empty, one line, at most forty characters, and unique **ignoring
 * case across the whole vocabulary including retired entries** — a retired label
 * is still rendering on the records that wear it, so its name is still taken.
 */
function definitionName(
  vocabulary: readonly { readonly id: number; readonly name: string }[],
  raw: string,
  except?: number,
): string {
  const name = raw.trim()
  if (name.length === 0) throw failure('BAD_REQUEST', 'a name must not be empty')
  if (name.length > 40) throw failure('BAD_REQUEST', 'a name must be at most 40 characters')
  if (name.includes('\n')) throw failure('BAD_REQUEST', 'a name must be one line')

  const clash = vocabulary.find(
    (one) => one.id !== except && one.name.toLowerCase() === name.toLowerCase(),
  )
  if (clash !== undefined) throw failure('CONFLICT', `"${clash.name}" already exists`)
  return name
}

/**
 * Light validation, per type — the four rules the server applies, and no more
 * (*"we don't have to put in a lot of validations"*).
 *
 * The `date` rule round-trips rather than asking whether `Date.parse` is NaN,
 * because it is not for `2026-02-31`: V8 rolls that over to the 3rd of March, so
 * the simpler check accepts a day that does not exist and then means a different
 * one (`definition-input.schema.ts` carries the measurement).
 */
function attributeValue(type: AttributeType, raw: string): string {
  const value = raw.trim()
  if (value.length === 0) throw failure('BAD_REQUEST', 'a value must not be empty')
  if (value.length > 500) throw failure('BAD_REQUEST', 'a value must be at most 500 characters')

  const ok =
    type === 'number'
      ? Number.isFinite(Number(value))
      : type === 'url'
        ? /^https?:\/\/\S+$/.test(value)
        : type === 'date'
          ? /^\d{4}-\d{2}-\d{2}$/.test(value) &&
            new Date(value).toISOString().slice(0, 10) === value
          : true
  if (!ok) throw failure('BAD_REQUEST', `not a valid ${type}`)
  return value
}

/**
 * Everything that has happened to one record, oldest first — the record page's
 * timeline, derived the way `GetRecordByIdUseCase` derives it.
 *
 * Built in causal order and then sorted stably by the moment, which is the same
 * two-step the use case makes and for the same reason: a revision is filed
 * before a verdict can be given against it and a lifecycle act is taken after
 * the review, so ties keep the order the acts can only have happened in.
 *
 * The two versions are **positions**, not stored fields: "1-based and dense per
 * record" is exactly a row's index among that record's rows, and a second copy
 * on the row could disagree with the array it claims to number.
 */
function timelineOf(retro: Retrospective, record: RecordSeed): RecordTimeline {
  const timeline: RecordTimeline = []

  // The first filed draft that carries the rid, which is where the record was
  // filed — not necessarily revision 1, since the AI introduces records in later
  // drafts too (`doctorBlind` arrives with revision 3).
  const filed = revisionsFiled(retro).find((revision) =>
    revision.records.some((candidate) => candidate.rid === record.rid),
  )
  if (filed !== undefined) {
    // A revision is the AI's — the write path refuses any other actor — so the
    // author is a fact about the system rather than a literal typed here.
    timeline.push({ kind: 'created', at: filed.createdAt, revision: filed.n, actor: 'ai' })
  }

  for (const [index, row] of decisionsFor(retro.retroId, record.rid).entries()) {
    // A verdict is the human's, likewise.
    timeline.push({
      kind: 'decision',
      at: row.at,
      revision: row.revision,
      state: row.state,
      actor: 'human',
      version: index + 1,
    })
  }

  for (const [index, row] of lifecycleFor(retro.retroId, record.rid).entries()) {
    timeline.push({
      kind: 'lifecycle',
      at: row.at,
      status: row.status,
      actor: row.actor,
      refs: [...row.refs],
      note: row.note,
      version: index + 1,
    })
  }

  return timeline.sort((left, right) => (left.at < right.at ? -1 : left.at > right.at ? 1 : 0))
}

/**
 * The revision a message is written against: the one the page names, or the
 * latest when it names none. A revision is announced and never swapped in
 * (KC-0005), so a page pinned to `?rev=1` sends 1 while revision 2 exists.
 */
function writtenAgainst(retro: Retrospective, revision: number | undefined): number {
  return revision ?? latestRevisionN(retro)
}

/* ── the event stream ─────────────────────────────────────────────────────── */

/**
 * Who is watching, and which retrospective they asked about — because
 * `events.onRetro` is scoped to one, and a listener that heard another
 * retrospective's events would make a page invalidate over something that did
 * not happen to it. The scope is the reason the flat records page has no
 * subscription at all (A9).
 */
const listeners = new Set<{ retroId: number; emit: (event: TrackedEvent) => void }>()

function track(event: WireEvent): TrackedEvent {
  return { id: String(event.id), data: event }
}

/**
 * `retroId` is nullable since session 10, and the null case is the settings
 * page's: a label or attribute definition is **global**, so the row it writes
 * has no retrospective to be addressed to — which also means `events.onRetro`
 * delivers it to nobody, because that subscription is per-retrospective.
 *
 * It is written into the world anyway, because the outbox is this store's audit
 * trail and *"the user can be certain that the AI cannot mess around"* is a
 * claim those rows are the evidence for. The listener loop below already
 * excludes it: no listener's `retroId` is null.
 */
function publish(retroId: number | null, name: string, extra: Partial<WireEvent> = {}): void {
  const event: WireEvent = {
    id: world.nextId++,
    name,
    at: FIXED_TIME,
    retroId,
    revisionN: null,
    rid: null,
    ...extra,
  }
  world.events.push(event)
  for (const listener of listeners) {
    if (listener.retroId === event.retroId) listener.emit(track(event))
  }
}

/* ── the procedures ───────────────────────────────────────────────────────── */

export const mockRouter = {
  'retros.get': (input) => {
    const retro = requireRetro(input.retroId)
    return {
      retroId: retro.retroId,
      session: retro.session,
      project: retro.project,
      title: latestTitle(retro),
      retroNumber: retro.retroNumber,
      state: displayStateOf(retro),
      startedAt: retro.startedAt,
      finishedAt: retro.finishedAt,
      latestRevision: latestRevisionN(retro),
      revisions: revisionsFiled(retro).map((revision) => ({
        n: revision.n,
        createdAt: revision.createdAt,
        records: revision.records.length,
        // Modelled off the world's own ReviewFinished rows, never canned: the
        // reload scenario is about the page reading back a fact the press made.
        finishedAt: finishedAtOf(retro, revision.n),
      })),
    }
  },

  /**
   * The dashboard's flat list (KC-0020, N4). One row per retrospective the world
   * holds, newest first — and every row is the *same* row the server would
   * compute, derived rather than written out: the counts move as a scenario
   * decides records, the state follows a finish, and the name follows whatever
   * the latest draft called it.
   *
   * **The default world holds one retrospective**, so this is one row unless a
   * scenario arranges otherwise (`crossRetro`). That the list runs newest-first
   * across sessions is proved against the real router in
   * `apps/api/test/procedures.test.ts` and is not what a browser is for
   * (testing.md §The lowest layer that can express it) — what the browser is for
   * is this row's *content*, so a dashboard scenario asserts the one row whole
   * rather than sampling several.
   */
  'retros.list': () =>
    world.retros
      // Nothing filed, nothing to list: the fresh install, which is the only
      // state this list is ever empty in (`freshInstall`, routes/index.tsx).
      .filter((retro) => retro.filed > 0)
      .map((retro) => {
        const revision = revisionAt(retro, latestRevisionN(retro))
        const pending = pendingRids(retro).length
        return {
          retroId: retro.retroId,
          retroNumber: retro.retroNumber,
          title: latestTitle(retro),
          state: displayStateOf(retro),
          counts: { pending, decided: revision.records.length - pending },
          session: retro.session,
        }
      })
      .reverse(),

  'records.list': (input) => {
    const retro = requireRetro(input.retroId)
    const revision = revisionAt(retro, input.revision ?? latestRevisionN(retro))
    const records = [...revision.records].sort((left, right) => left.num - right.num)
    return {
      retroId: retro.retroId,
      revision: revision.n,
      pending: records.filter(
        (record) => effectiveDecision(retro, record, revision.n).state === 'pending',
      ).length,
      records: records.map((record) => summarise(retro, record, revision.n)),
    }
  },

  /**
   * The narrative, the proposals and the decision — and **not** the record's
   * comments. They came back from here until session 7 and the panel is the one
   * comments surface now, so `threads.list` is the only read path for them
   * (`views.schema.ts` §recordDetailSchema). `threadsFor` survives because the
   * AI's reply control still needs to find the newest thread on a record.
   */
  'records.get': (input) => {
    const retro = requireRetro(input.retroId)
    const revision = revisionAt(retro, input.revision ?? latestRevisionN(retro))
    return detailOf(retro, revision, narrativeAt(revision, input.rid))
  },

  /**
   * **One record, reached by the number the page shows** — the record page
   * (`/records/:id`, the owner's session-9 ask). It is the one record read
   * addressed by the global id rather than by `(retroId, rid)`, so the world
   * runs its own sequence backwards exactly as the store does, and everything
   * after that is the pair every other procedure here takes.
   *
   * Two shapes of miss, both the server's. A number nothing was minted for is
   * NOT_FOUND from the lookup; a record a later draft withdrew is NOT_FOUND from
   * `narrativeAt`, because this reads the **latest** revision and only that —
   * which is what makes everything the page shows something its own controls can
   * act on.
   *
   * Every key beyond the record itself is derived from the world: the identity
   * line off the record's own retrospective (never the page's, A5), the
   * lifecycle off the entry in force, and the timeline off the three tables that
   * hold it.
   */
  'records.byId': (input) => {
    const minted = world.recordIds.find((row) => row.id === input.id)
    if (minted === undefined) throw failure('NOT_FOUND', `No record with id ${input.id}`)

    const retro = requireRetro(minted.retroId)
    const revision = revisionAt(retro, latestRevisionN(retro))
    const record = narrativeAt(revision, minted.rid)

    return {
      ...detailOf(retro, revision, record),
      retroNumber: retro.retroNumber,
      session: retro.session,
      lifecycle: lifecycleOf(retro, record),
      // The one key this page adds that the review card does not read: a value
      // is data about a record and is something you go and look at, where a
      // label is a classification worth a tag wherever the record is listed.
      attributes: attributesOf(retro.retroId, record.rid),
      // Both directions off the one set of rows — the same read from either end,
      // with the direction the only thing that differs.
      relations: relationsOf(input.id),
      timeline: timelineOf(retro, record),
    }
  },

  /**
   * The flat cross-retro records page (the owner's session-8 ask): every record
   * of every retrospective, each row derived rather than written out — the
   * verdicts move as a scenario decides records, and the lifecycle marks move as
   * it resolves them.
   *
   * **Newest retro first, records by number inside it**, which is the use case's
   * own order (`list-all-records.use-case.ts`: retro id descending, so the order
   * does not depend on a clock) and the reason the retros are held oldest-first
   * and reversed here rather than sorted: reversing one flat array would turn
   * every retrospective's records upside down with it.
   *
   * That ordering, and that a rid in one retro never picks up another retro's
   * resolution, are both proved against the real router in
   * `apps/api/test/procedures.test.ts` and stay proved there. What the world
   * carries a second and third retrospective for is what only a browser can
   * answer — see `crossRetro`.
   */
  'records.listAll': () =>
    world.retros
      // Nothing filed, nothing to list: the fresh install, the only state this
      // page is ever empty in for a reason other than a filter.
      .filter((retro) => retro.filed > 0)
      .map((retro) => {
        const revision = revisionAt(retro, latestRevisionN(retro))
        return [...revision.records]
          .sort((left, right) => left.num - right.num)
          .map((record) => {
            const decision = effectiveDecision(retro, record, revision.n)
            return {
              retroId: retro.retroId,
              retroNumber: retro.retroNumber,
              session: retro.session,
              rid: record.rid,
              globalId: globalIdOf(retro.retroId, record.rid),
              num: record.num,
              title: record.title,
              type: record.type,
              requester: record.requester,
              // Both effective rather than stored, so a scenario that decides a
              // record sees the chip and the SEV follow (D2).
              state: decision.state,
              severity: decision.severity,
              proposedLevel: proposedLevel(record),
              lifecycle: lifecycleOf(retro, record),
              // Effective too, and for the same reason the two above it are: the
              // dashboard's "Require human" tile counts open records
              // whose involvement is `interactive`, so a scenario that decides a
              // record into `interactive` has to see the tile move. Reading the
              // record's authored default here instead would make the mock answer
              // a question the real router answers differently.
              involvement: decision.involvement,
              // Resolved rather than sent as ids: the filter is the only reader
              // that would hold the vocabulary, and every other reader of this
              // row just draws the word.
              labels: labelsOf(retro.retroId, record.rid),
            }
          })
      })
      .reverse()
      .flat(),

  /**
   * The human marks a record resolved, or reopens it.
   *
   * **It does not refuse a finished retrospective**, and that is the one place
   * this differs from `threads.resolve` two procedures down. Every other human
   * write closes when the review closes; the owner asked for this one *because*
   * the retro is closed — *"even after a retro has been closed, we should be
   * able to attach metadata to issues"* — so a scenario can resolve a record on
   * a review it has just watched close.
   */
  'records.setLifecycle': (input) => {
    const retro = requireRetro(input.retroId)
    const record = narrativeAt(revisionAt(retro, latestRevisionN(retro)), input.rid)
    const refs = lifecycleRefs(input)

    const previous = lifecycleFor(retro.retroId, record.rid)
    if (input.status === 'reopened' && previous.length === 0) {
      throw failure(
        'CONFLICT',
        `record ${record.rid} has never been resolved, so there is nothing to reopen`,
      )
    }

    return {
      retroId: retro.retroId,
      rid: record.rid,
      // A record born archived has no rows, so its first act is still version 1
      // — the same arithmetic the server does, over the same absence.
      version: previous.length + 1,
      lifecycle: appendLifecycle(retro, record, input.status, refs, input.note ?? null, 'human'),
    }
  },

  /**
   * **Two records said to belong together, or the relation taken off** (the
   * owner's session-11 ask).
   *
   * **It does not refuse a finished retrospective**, and that is more true here
   * than for `records.setLifecycle` above: the record at the far end is normally
   * in a retrospective that closed sessions ago, which is what *"find past
   * records"* means.
   *
   * Every refusal the server makes is made here, because a page that offered an
   * act the real server rejects is a page that would ship: a record related to
   * itself, a number nothing was minted for, a record a later draft withdrew, a
   * pair that already stands, and a relate with no words. The words are half the
   * act — *"each relation carries how-they-relate words"* — and the un-relate row
   * carries forward the words of the relation it takes off, which is why this
   * handler never takes them from the caller.
   */
  'records.relate': (input) => {
    if (input.fromId === input.toId) {
      throw failure(
        'BAD_REQUEST',
        `record ${input.fromId} cannot be related to itself; a relation names two records`,
      )
    }
    for (const id of [input.fromId, input.toId]) {
      if (recordAt(id) === undefined) throw failure('NOT_FOUND', `No record with id ${id}`)
    }

    /**
     * Trimmed **for the emptiness test only**. Free text travels verbatim
     * everywhere in this product — `nonEmptyTextSchema` refines on a trimmed
     * value and transforms nothing (`text.schema.ts`) — so what the author typed
     * is what the row holds, spaces and all. A mock that stored the trim would be
     * answering a question this wire does not ask.
     */
    const how = input.how ?? ''
    if (input.related && how.trim().length === 0) {
      throw failure('BAD_REQUEST', 'a relation must say how the two records relate')
    }
    if (!input.related && (input.how ?? '').length > 0) {
      throw failure(
        'BAD_REQUEST',
        'un-relating two records takes no words; the row carries forward the words of the relation it takes off',
      )
    }

    const previous = latestRelation(input.fromId, input.toId)
    const standing = previous?.applied ?? false
    if (standing === input.related) {
      throw failure(
        'CONFLICT',
        `records #${input.fromId} and #${input.toId} are ${standing ? 'already related' : 'not related'}`,
      )
    }

    world.recordRelations.push({
      // The next number in the world's own sequence, exactly as an AUTOINCREMENT
      // hands one out: strictly increasing, never reused, and what the order of
      // a record's relations is read from.
      seq: nextRelationSeq(),
      fromId: input.fromId,
      toId: input.toId,
      version: (previous?.version ?? 0) + 1,
      applied: input.related,
      // Relating carries the caller's words; un-relating carries the ones the
      // relation it takes off was written with — never nothing, and never new.
      how: input.related ? how : (previous?.how ?? ''),
      actor: 'human',
      at: stamp(),
    })
    const from = recordAt(input.fromId)
    if (from !== undefined) {
      publish(from.retro.retroId, input.related ? 'RecordRelated' : 'RecordUnrelated', {
        rid: from.record.rid,
      })
    }

    return {
      fromId: input.fromId,
      toId: input.toId,
      version: (previous?.version ?? 0) + 1,
      // Without titles, exactly as the router answers: naming the far end costs a
      // read of its retrospective and the page re-reads for that.
      relations: relationsOf(input.fromId).map((relation) => ({
        globalId: relation.globalId,
        how: relation.how,
        direction: relation.direction,
        actor: relation.actor,
        at: relation.at,
      })),
    }
  },

  'decisions.record': (input) => {
    const retro = requireRetro(input.retroId)
    if (retro.state === 'finished') {
      throw failure('CONFLICT', 'This review is finished; its decisions no longer change.')
    }

    const record = narrativeAt(revisionAt(retro, input.revision), input.rid)
    const previous = latestDecisionFor(retro.retroId, input.rid)
    // Omitted values keep what stands: the human's last answer if they gave one,
    // the AI's proposal if they never have. Nothing here invents a verdict —
    // `state` is required by the router precisely so it cannot (KC-0010).
    world.decisions.push({
      retroId: retro.retroId,
      rid: input.rid,
      revision: input.revision,
      at: stamp(),
      state: input.state,
      severity: input.severity ?? previous?.severity ?? record.proposed.severity,
      ...chooseSolution(record, input, previous),
      involvement: input.involvement ?? previous?.involvement ?? record.proposed.involvement,
      reviewerNote: input.reviewerNote ?? previous?.reviewerNote ?? null,
    })
    publish(retro.retroId, 'DecisionRecorded', { rid: input.rid, revisionN: input.revision })

    return {
      rid: input.rid,
      version: world.decisions.filter(
        (row) => row.retroId === retro.retroId && row.rid === input.rid,
      ).length,
      decision: effectiveDecision(retro, record, latestRevisionN(retro)),
    }
  },

  'threads.open': (input) => {
    const retro = requireRetro(input.retroId)
    const thread: ThreadRow = {
      retroId: retro.retroId,
      id: world.nextId++,
      rid: input.target.kind === 'record' ? input.target.rid : null,
      section: input.target.kind === 'record' ? input.target.section : null,
      openedAt: FIXED_TIME,
      messages: [
        {
          id: world.nextId++,
          actor: 'human',
          text: input.text,
          at: FIXED_TIME,
          revision: writtenAgainst(retro, input.revision),
        },
      ],
    }
    world.threads.push(thread)
    publish(retro.retroId, 'CommentAdded', { rid: thread.rid })
    return toWireThread(thread)
  },

  'threads.reply': (input) => {
    const thread = world.threads.find((candidate) => candidate.id === input.threadId)
    if (thread === undefined) throw failure('NOT_FOUND', `No thread with id ${input.threadId}`)

    const message: Message = {
      id: world.nextId++,
      actor: 'human',
      text: input.text,
      at: FIXED_TIME,
      revision: writtenAgainst(requireRetro(thread.retroId), input.revision),
    }
    const replied = replaceThread({ ...thread, messages: [...thread.messages, message] })
    publish(replied.retroId, 'CommentAdded', { rid: replied.rid })
    return toWireThread(replied)
  },

  /**
   * **Every thread of the retrospective**, record-level and review-level alike —
   * the same answer the router gives since session 7, so a panel that dropped
   * the record comments would fail in a scenario rather than only against the
   * real server.
   */
  'threads.list': (input) => {
    const retro = requireRetro(input.retroId)
    return world.threads.filter((thread) => thread.retroId === retro.retroId).map(toWireThread)
  },

  /**
   * The human settles a thread, or takes it back (`r-resolvable-comments`).
   *
   * A row per act rather than a flag on the thread, because that is what the
   * store does: reopening appends a version and the highest one is what stands,
   * so nothing here overwrites what he did before.
   */
  'threads.resolve': (input) => {
    const thread = world.threads.find((candidate) => candidate.id === input.threadId)
    if (thread === undefined) throw failure('NOT_FOUND', `No thread with id ${input.threadId}`)
    if (requireRetro(thread.retroId).state === 'finished') {
      throw failure('CONFLICT', 'This review is finished; its threads are settled.')
    }

    world.resolutions.push({ threadId: thread.id, resolved: input.resolved })
    publish(thread.retroId, input.resolved ? 'ThreadResolved' : 'ThreadReopened', {
      rid: thread.rid,
    })
    return toWireThread(thread)
  },

  /**
   * The page's one terminal action (retro 4 `r-one-finish-button`), with both
   * of the properties that record and `r-request-changes-multi-press` gave it:
   *
   * - it does **not** finish the retrospective — it closes the human's side of
   *   this round, and the state stays `reviewing` until the AI closes it
   *   (`MockControl.closeReview`, which is that act in its own process);
   * - a second press for the same revision is absorbed. No second event, no
   *   error: the answer is the one the first press got.
   */
  'review.finish': (input) => {
    const retro = requireRetro(input.retroId)
    if (retro.state === 'finished') {
      throw failure('CONFLICT', 'This review is already finished.')
    }

    const pending = pendingRids(retro)
    if (pending.length > 0) {
      throw failure('PRECONDITION_FAILED', `${pending.length} record(s) are still undecided.`, {
        pendingRids: pending,
      })
    }

    const revision = latestRevisionN(retro)
    if (!finishedRound(retro, revision)) {
      /**
       * As strict as the server, deliberately (R-MOCK-LOCK, and
       * `r-mock-extra-field-blind`): the use case trims the message and writes
       * no row for a blank one, so a mock that stored `'   '` would let a
       * scenario prove a behaviour the product does not have. It rides the
       * press for the same reason it does there — an absorbed second press
       * writes nothing at all, which is what the `finishedRound` guard already
       * says about the event.
       */
      const message = input.finishMessage?.trim() ?? ''
      if (message.length > 0) {
        world.finishMessages.push({ retroId: retro.retroId, revision, message })
      }
      publish(retro.retroId, 'ReviewFinished', { revisionN: revision })
    }

    return {
      retroId: retro.retroId,
      // `submitted` every time, absorbed second press included — the same
      // constant the real router answers with, and for the same reason: the
      // press cannot close the retrospective and cannot leave the round open.
      state: displayStateOf(retro),
      revision,
      finishedAt: retro.finishedAt,
    }
  },

  /* ── the two vocabularies, and what records wear from them ──────────────── */

  /**
   * The whole label vocabulary, **retired entries included**, in minting order —
   * the settings page's list, and the source a record page resolves an "add a
   * label" menu from.
   *
   * Retired entries are on it because filtering is the reader's: the settings
   * page greys them, the add-a-label menu drops them, and the filter offers one
   * as long as a record still wears it. Three readers, three different subsets,
   * one answer.
   */
  'labels.list': () => world.labelDefinitions.map((definition) => ({ ...definition })),

  'labels.define': (input) => {
    const name = definitionName(world.labelDefinitions, input.name)
    const definition: LabelDefinition = {
      // Per vocabulary and 1-based, which is what SQLite's own AUTOINCREMENT
      // gives each table — not the world's shared counter (see the fixture).
      id: Math.max(0, ...world.labelDefinitions.map((one) => one.id)) + 1,
      name,
      retiredAt: null,
      createdAt: stamp(),
    }
    world.labelDefinitions.push(definition)
    publish(null, 'LabelDefined')
    return { ...definition }
  },

  /**
   * A rename writes over the row, so **every record wearing the label reads the
   * new name at once** — which is what makes a definition configuration rather
   * than human data, and is a thing a scenario can watch happen.
   *
   * A retired label may still be renamed: it is on records and rendering, and a
   * typo in it is as worth fixing as one in an offerable label.
   */
  'labels.rename': (input) => {
    const definition = requireLabel(input.id)
    // Its own row is not a clash: `migrated` → `Migrated` is a case correction.
    const name = definitionName(world.labelDefinitions, input.name, definition.id)
    const renamed: LabelDefinition = { ...definition, name }
    world.labelDefinitions = world.labelDefinitions.map((one) =>
      one.id === renamed.id ? renamed : one,
    )
    publish(null, 'LabelRenamed')
    return { ...renamed }
  },

  /**
   * Retiring is **not** a delete: the row stays, the records that wear the label
   * go on wearing it, and what stops is the offering. Retiring twice is refused
   * rather than absorbed, on the standing that answering "done" to an act that
   * did nothing is the quiet inference this product refuses everywhere else.
   */
  'labels.retire': (input) => {
    const definition = requireLabel(input.id)
    if (definition.retiredAt !== null) {
      throw failure('CONFLICT', `"${definition.name}" was already retired`)
    }
    const retired: LabelDefinition = { ...definition, retiredAt: stamp() }
    world.labelDefinitions = world.labelDefinitions.map((one) =>
      one.id === retired.id ? retired : one,
    )
    publish(null, 'LabelRetired')
    return { ...retired }
  },

  /**
   * Retire's inverse, and the mock models the same two refusals the server has:
   * a definition nothing answers to is NOT_FOUND, and one that is not retired is
   * a CONFLICT rather than a quiet success. Neither is something the page sends,
   * which is exactly what makes the page's own guard falsifiable — the row only
   * offers this control on a retired row (`vocabulary.tsx`).
   */
  'labels.unretire': (input) => {
    const definition = requireLabel(input.id)
    if (definition.retiredAt === null) {
      throw failure('CONFLICT', `"${definition.name}" is not retired`)
    }
    const restored: LabelDefinition = { ...definition, retiredAt: null }
    world.labelDefinitions = world.labelDefinitions.map((one) =>
      one.id === restored.id ? restored : one,
    )
    publish(null, 'LabelUnretired')
    return { ...restored }
  },

  /**
   * The human puts a label on a record, or takes it off.
   *
   * **It does not refuse a finished retrospective**, and that is the owner's
   * second usage archetype rather than an oversight: *"on completion of the
   * retro they may actually want to move everything into GitHub right away …
   * they could actually put a label that says 'migrated'"*. That act happens
   * after the close by construction.
   *
   * Two refusals mirrored from the server, both of them things the page never
   * sends and both of them therefore the only way its guards are falsifiable: a
   * retired label cannot be applied (it can always be removed), and a no-op is a
   * CONFLICT rather than a quiet success.
   */
  'labels.set': (input) => {
    const retro = requireRetro(input.retroId)
    const record = narrativeAt(revisionAt(retro, latestRevisionN(retro)), input.rid)
    const definition = requireLabel(input.labelId)

    if (input.applied && definition.retiredAt !== null) {
      throw failure(
        'CONFLICT',
        `"${definition.name}" was retired and is no longer offered; it can still be removed`,
      )
    }

    const previous = latestOf(labelRows(retro.retroId, record.rid, definition.id))
    const standing = previous?.applied ?? false
    if (standing === input.applied) {
      throw failure(
        'CONFLICT',
        `record ${record.rid} ${standing ? 'already carries' : 'does not carry'} "${definition.name}"`,
      )
    }

    world.recordLabels.push({
      retroId: retro.retroId,
      rid: record.rid,
      labelId: definition.id,
      version: (previous?.version ?? 0) + 1,
      applied: input.applied,
    })
    publish(retro.retroId, input.applied ? 'RecordLabelApplied' : 'RecordLabelRemoved', {
      rid: record.rid,
    })

    return {
      retroId: retro.retroId,
      rid: record.rid,
      version: (previous?.version ?? 0) + 1,
      labels: labelsOf(retro.retroId, record.rid),
    }
  },

  'attributes.list': () => world.attributeDefinitions.map((definition) => ({ ...definition })),

  'attributes.define': (input) => {
    const name = definitionName(world.attributeDefinitions, input.name)
    const definition: AttributeDefinition = {
      id: Math.max(0, ...world.attributeDefinitions.map((one) => one.id)) + 1,
      name,
      type: input.type,
      retiredAt: null,
      createdAt: stamp(),
    }
    world.attributeDefinitions.push(definition)
    publish(null, 'AttributeDefined')
    return { ...definition }
  },

  /** The name changes and the type does not — there is no input here that could. */
  'attributes.rename': (input) => {
    const definition = requireAttribute(input.id)
    const name = definitionName(world.attributeDefinitions, input.name, definition.id)
    const renamed: AttributeDefinition = { ...definition, name }
    world.attributeDefinitions = world.attributeDefinitions.map((one) =>
      one.id === renamed.id ? renamed : one,
    )
    publish(null, 'AttributeRenamed')
    return { ...renamed }
  },

  'attributes.retire': (input) => {
    const definition = requireAttribute(input.id)
    if (definition.retiredAt !== null) {
      throw failure('CONFLICT', `"${definition.name}" was already retired`)
    }
    const retired: AttributeDefinition = { ...definition, retiredAt: stamp() }
    world.attributeDefinitions = world.attributeDefinitions.map((one) =>
      one.id === retired.id ? retired : one,
    )
    publish(null, 'AttributeRetired')
    return { ...retired }
  },

  /** The attribute half of the un-retire pair — and the type rides back with it. */
  'attributes.unretire': (input) => {
    const definition = requireAttribute(input.id)
    if (definition.retiredAt === null) {
      throw failure('CONFLICT', `"${definition.name}" is not retired`)
    }
    const restored: AttributeDefinition = { ...definition, retiredAt: null }
    world.attributeDefinitions = world.attributeDefinitions.map((one) =>
      one.id === restored.id ? restored : one,
    )
    publish(null, 'AttributeUnretired')
    return { ...restored }
  },

  /**
   * A value on a record, or **absent to clear it** — the one place on this wire
   * where a missing field means something rather than nothing.
   *
   * Two differences from its label twin, both the server's: the value is
   * validated against the definition's type, and **setting the same value again
   * is allowed** where applying a label a record already wears is refused — a
   * value is an assignment and re-asserting one is a thing a person does, where
   * "already on" is not something anyone means to say twice. What is still
   * refused is clearing what is not there.
   */
  'attributes.set': (input) => {
    const retro = requireRetro(input.retroId)
    const record = narrativeAt(revisionAt(retro, latestRevisionN(retro)), input.rid)
    const definition = requireAttribute(input.attributeId)

    if (input.value !== undefined && definition.retiredAt !== null) {
      throw failure(
        'CONFLICT',
        `"${definition.name}" was retired and is no longer offered; it can still be cleared`,
      )
    }

    const value = input.value === undefined ? null : attributeValue(definition.type, input.value)
    const previous = latestOf(attributeRows(retro.retroId, record.rid, definition.id))
    if (value === null && (previous?.value ?? null) === null) {
      throw failure('CONFLICT', `record ${record.rid} carries no value for "${definition.name}"`)
    }

    const version = (previous?.version ?? 0) + 1
    world.recordAttributeValues.push({
      retroId: retro.retroId,
      rid: record.rid,
      attributeId: definition.id,
      version,
      value,
    })
    publish(retro.retroId, value === null ? 'RecordAttributeCleared' : 'RecordAttributeSet', {
      rid: record.rid,
    })

    return {
      retroId: retro.retroId,
      rid: record.rid,
      version,
      values: attributesOf(retro.retroId, record.rid),
    }
  },

  /* ── the toggle ─────────────────────────────────────────────────────────── */

  'settings.get': () => ({ aiConfigWrite: world.aiConfigWrite }),

  /**
   * OWNER RULING 2's switch, moved by the human — which is the only actor a
   * browser can be (`context.ts`), so there is nothing here to refuse.
   *
   * **The guarantee it makes is not modelled here and cannot be.** What the
   * switch governs is whether the *AI* may write definitions, and the AI never
   * comes through this module: it runs in its own process against the same
   * store. That refusal is proved where it lives, below every adapter, in
   * `packages/core/test/unit/settings.test.ts`. What a scenario can watch here
   * is the page reading the switch back, which is what the world models.
   */
  'settings.setAiConfigWrite': (input) => {
    world.aiConfigWrite = input.enabled
    publish(null, input.enabled ? 'AiConfigWriteEnabled' : 'AiConfigWriteDisabled')
    return { aiConfigWrite: world.aiConfigWrite }
  },

  'events.onRetro': (input, emit) => {
    const retro = requireRetro(input.retroId)
    // No `lastEventId` means "from now", exactly as the server reads it: the
    // queries the page has just run already carry the history.
    const from = Number.parseInt(input.lastEventId ?? '', 10)
    if (Number.isInteger(from)) {
      const replay = world.events.filter(
        // This retrospective's own history, because that is the scope the
        // procedure has: a page resuming from `Last-Event-ID` must not be handed
        // what happened in a retrospective it never asked about.
        (candidate) => candidate.id > from && candidate.retroId === retro.retroId,
      )
      for (const event of replay) emit(track(event))
    }

    const listener = { retroId: retro.retroId, emit }
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
} satisfies MockRouter

/** The runtime half of the procedure-set check (`test/procedure-set.spec.ts`). */
export const MOCK_PROCEDURE_PATHS: readonly ProcedurePath[] = Object.keys(
  mockRouter,
).sort() as ProcedurePath[]

/* ── the link ─────────────────────────────────────────────────────────────── */

type Envelope = { result: { type?: 'data' | 'started'; data?: unknown } }

/**
 * A hand-rolled observable, because `@trpc/server/observable` is banned in this
 * package and rightly so. Only `subscribe` is ever reached: the client wraps
 * every chain in its own observable and pipes *that*, never a terminating link's.
 */
function resultObservable(
  start: (observer: {
    next: (envelope: Envelope) => void
    error: (failed: TRPCClientError<AppRouter>) => void
    complete: () => void
  }) => (() => void) | undefined,
) {
  return {
    subscribe(observer: {
      next?: (envelope: never) => void
      error?: (failed: never) => void
      complete?: () => void
    }) {
      let live = true
      const stop = start({
        next: (envelope) => {
          if (live) observer.next?.(envelope as never)
        },
        error: (failed) => {
          if (!live) return
          live = false
          observer.error?.(failed as never)
        },
        complete: () => {
          if (!live) return
          live = false
          observer.complete?.()
        },
      })
      return {
        unsubscribe() {
          live = false
          stop?.()
        },
      }
    },
    pipe: (() => {
      throw new Error('the mock link terminates the chain; nothing pipes it')
    }) as never,
  }
}

function asFailure(thrown: unknown): TRPCClientError<AppRouter> {
  if (thrown instanceof TRPCClientError) return thrown as TRPCClientError<AppRouter>
  throw thrown
}

const mockLink: TRPCLink<AppRouter> = () => {
  return ({ op }) =>
    resultObservable((observer) => {
      const path = op.path as ProcedurePath

      if (op.type === 'subscription') {
        const stream = mockRouter[path as SubscriptionPath]
        let stop: (() => void) | undefined
        try {
          observer.next({ result: { type: 'started' } })
          stop = stream(op.input as InputOf<SubscriptionPath>, (item) => {
            observer.next({ result: { type: 'data', data: item } })
          })
        } catch (thrown) {
          observer.error(asFailure(thrown))
        }
        return () => stop?.()
      }

      try {
        const call = mockRouter[path] as (input: unknown) => unknown
        observer.next({ result: { type: 'data', data: call(op.input) } })
        observer.complete()
      } catch (thrown) {
        observer.error(asFailure(thrown))
      }
      return undefined
    }) as never
}

/** The seam `@/lib/transport` declares; see `src/lib/link-contract.ts`. */
export const createTrpcLinks: TrpcLinkFactory = () => [mockLink]

/* ── what a scenario is allowed to do to the world ────────────────────────── */

/**
 * The AI's two moves, exposed to the browser so a scenario can make them happen.
 *
 * There is deliberately nothing here for the human's side: every human act in
 * these tests goes through the page, through the tRPC client, into the router
 * above — which is what makes the scenarios evidence about the UI rather than
 * about the fixture.
 */
export type MockControl = {
  /** The AI files the next revision. Announced over the stream; never swapped in. */
  fileRevision: () => void
  /** An AI reply lands in the newest thread of a record. */
  aiReply: (rid: string, text: string) => void
  /** An AI reply lands in the newest thread about the review itself. */
  aiReviewReply: (text: string) => void
  /**
   * **The AI marks a record resolved after fixing it** — the act the owner's
   * lifecycle ask is actually about, taken in the AI's own process.
   *
   * It is here rather than on the router for the reason `closeReview` is: the
   * browser's context is `human` unconditionally, so no procedure the page can
   * call could ever write an AI-authored entry. A scenario that wants to see
   * one — which is what "AI-written entries render with attribution" needs —
   * reaches for this.
   *
   * **It takes a retrospective**, unlike everything else on this surface. The
   * others are acts *within the review the page is on* and there is only ever
   * one of those; this one is the AI working through a fix queue that spans
   * retrospectives, which is the whole reason the flat page exists — and a rid
   * on its own does not name a record (A5).
   */
  aiResolve: (retroId: number, rid: string, refs: readonly string[], note?: string) => void
  /**
   * The AI closes the review to export — `reviewing → finished`, terminal
   * (retro 4 `r-one-finish-button`). It is here rather than on the router
   * because it is the AI's act, taken in the AI's own process: there is no
   * procedure for it and the browser could not reach one.
   */
  closeReview: () => void
  /**
   * **The human takes a verdict back somewhere else, and this page has not heard
   * yet** — the one state the finish flow's send-time backstop exists for
   * (`r-finish-refusal-fires-late`).
   *
   * The gate now refuses on the first click, from what the page already knows,
   * so the only way the send can still be refused is that the world changed
   * under a page holding a stale answer. That is a race and not a fiction: an
   * undo on another device does publish, and the window this models is the one
   * before the event arrives. So it deliberately does **not** publish — a
   * `DecisionRecorded` here would invalidate the list, the page would learn, and
   * the backstop would never be reachable in a scenario.
   *
   * It is the human's act, taken in another browser, which is why it writes a
   * human field at all: the AI never could (architecture.md §Actor model), and
   * the control that closes the review sits beside this one precisely because
   * that one is the AI's.
   */
  undecideElsewhere: (rid: string) => void
  /** How many events of this name the world has seen. */
  eventCount: (name: string) => number
  /**
   * The word the human left finishing the round the page is on, or `null`.
   *
   * A read, like `eventCount` beside it, and not a way in: it is the AI's side
   * of the channel the owner asked for — what `revision get --feedback-only`
   * would carry — so a scenario can say the message was *delivered* rather than
   * that a textarea once held it.
   */
  finishMessage: () => string | null
}

/**
 * Every act here but `aiResolve` is an act *within the review the page is on*,
 * so it is taken against `underReview()` — the world's first retrospective, the
 * only one any page other than `/records` is ever about. The closed ones are
 * finished history: nothing files a revision into them and nothing closes them
 * twice.
 */
const control: MockControl = {
  fileRevision() {
    const retro = underReview()
    if (retro.filed >= retro.revisions.length) {
      throw new Error('the fixture has no further revision')
    }
    retro.filed += 1
    // A record this draft introduces is minted now, at the end of the sequence —
    // after every record of every retrospective that already existed, including
    // the ones started later. That is what "minted at first appearance" means,
    // and it is the one arrangement in this world where a record's global number
    // and its per-retro `num` cannot be confused for each other.
    mintRecordIds(world.recordIds, retro, [revisionAt(retro, retro.filed)])
    publish(retro.retroId, 'RevisionCreated', { revisionN: retro.filed })
  },

  aiReply(rid, text) {
    const retro = underReview()
    const thread = threadsFor(retro.retroId, rid).at(-1)
    if (thread === undefined) throw new Error(`no thread on ${rid} for the AI to reply in`)
    replaceThread({
      ...thread,
      messages: [
        ...thread.messages,
        {
          id: world.nextId++,
          actor: 'ai',
          text,
          at: FIXED_TIME,
          revision: latestRevisionN(retro),
        },
      ],
    })
    publish(retro.retroId, 'CommentAdded', { rid })
  },

  closeReview() {
    const retro = underReview()
    if (retro.state === 'finished') throw new Error('the review is already closed')
    if (!finishedRound(retro, latestRevisionN(retro))) {
      throw new Error('the reviewer has not finished this round')
    }
    retro.state = 'finished'
    retro.finishedAt = FIXED_TIME
    publish(retro.retroId, 'ReviewClosed', { revisionN: latestRevisionN(retro) })
  },

  undecideElsewhere(rid) {
    const retro = underReview()
    const previous = latestDecisionFor(retro.retroId, rid)
    if (previous === undefined) throw new Error(`${rid} has no verdict to take back`)
    world.decisions.push({ ...previous, at: stamp(), state: 'pending' })
  },

  eventCount(name) {
    return world.events.filter((event) => event.name === name).length
  },

  finishMessage() {
    const retro = underReview()
    const revision = latestRevisionN(retro)
    return (
      world.finishMessages.find((one) => one.retroId === retro.retroId && one.revision === revision)
        ?.message ?? null
    )
  },

  aiResolve(retroId, rid, refs, note) {
    // The same shape the router refuses in, because the AI's writes obey the
    // same domain rule: the evidence is the point.
    if (refs.length === 0) throw new Error('the AI cannot resolve a record citing nothing')
    const retro = requireRetro(retroId)
    const record = narrativeAt(revisionAt(retro, latestRevisionN(retro)), rid)
    appendLifecycle(
      retro,
      record,
      'resolved',
      refs.map((ref) => ref.trim()),
      note ?? null,
      'ai',
    )
  },

  aiReviewReply(text) {
    const retro = underReview()
    const thread = reviewThreads(retro.retroId).at(-1)
    if (thread === undefined) throw new Error('no review-level thread for the AI to reply in')
    replaceThread({
      ...thread,
      messages: [
        ...thread.messages,
        {
          id: world.nextId++,
          actor: 'ai',
          text,
          at: FIXED_TIME,
          revision: latestRevisionN(retro),
        },
      ],
    })
    // `rid` stays null: this comment is about no record, which is exactly why
    // the record queries cannot be what refreshes it.
    publish(retro.retroId, 'CommentAdded')
  },
}

declare global {
  interface Window {
    retroMock?: MockControl
    /**
     * Set by a scenario before the app boots, read once by the fixture; see
     * `bareReview`. Deliberately not on `MockControl`: that is the surface for
     * what the AI *does* during a scenario, and this is what the world started
     * as.
     */
    retroMockBareReview?: boolean
    /** The same, for the empty product; see `freshInstall`. */
    retroMockFreshInstall?: boolean
    /** The same, for a store carrying the frozen `hold` verdict; see `legacyHoldVerdict`. */
    retroMockLegacyHoldVerdict?: boolean
    /**
     * The same, for a stage holding more than one retrospective — the world the
     * flat records page is about; see `crossRetro`.
     */
    retroMockCrossRetro?: boolean
    /** The same, for a store whose vocabulary nobody has configured; see `bareVocabulary`. */
    retroMockBareVocabulary?: boolean
  }
}

if (typeof window !== 'undefined') {
  world = initialWorld()
  window.retroMock = control
}
