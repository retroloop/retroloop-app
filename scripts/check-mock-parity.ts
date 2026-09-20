#!/usr/bin/env bun

/**
 * R-MOCK-LOCK enforcement — the fourth direction (`r-mock-extra-field-blind`).
 *
 * `mockRouter satisfies MockRouter` fails the build on a missing procedure, an
 * extra procedure and a mistyped field. It does **not** fail on an extra field
 * canned into a procedure's answer, and that is not an oversight anyone can fix
 * in the mock: TypeScript infers an arrow handler's return type from its literal
 * and then checks the whole function type for assignability, so excess-property
 * checking never fires on the returned object. An isolated repro proved it —
 * extra procedure, missing procedure and mistyped field all fail; an extra field
 * compiles clean. Layer 2's text scan cannot see it either, which left the
 * reviewer agent as the only detector for a re-canned derived field, and that is
 * the most expensive one the repo runs.
 *
 * So this script runs every mock procedure against the mock's own fixture world
 * and hands each answer to the schema the real router validates that answer
 * with. Every shape in `views.schema.ts` is a `z.strictObject`, which refuses
 * unknown keys at any depth — so an extra canned field fails the gate.
 *
 * `scripts/` is where this can live: `check-deps.ts` scans four packages and
 * this is not one of them, so reading both sides here leaves the type-only
 * `web -> api` edge exactly as it was.
 *
 * The check is exported as a function so its own tests can hand it a doctored
 * router and watch it fail — a gate that cannot fail is no gate, and this one
 * cannot be pointed at a fixture tree the way `--root` points the text scans.
 */

import type { AppRouterInputs } from '../apps/api/src/trpc/router.ts'
import { wireEventSchema } from '../apps/api/src/trpc/views.schema.ts'
import { mockRouter, type ProcedurePath } from '../apps/web/test/trpc-mock.ts'

/* ── the two sides, as types ──────────────────────────────────────────────── */

type Namespace = keyof AppRouterInputs & string

/** Derived the way the mock derives it, so a router change breaks the plan below. */
type InputOf<P extends ProcedurePath> = P extends `${infer N extends Namespace}.${infer L}`
  ? L extends keyof AppRouterInputs[N]
    ? AppRouterInputs[N][L]
    : never
  : never

/**
 * All this check asks of a schema. `zod` is a dependency of `apps/api`, not of
 * the root, so it is never imported here by name — the schemas arrive as values
 * through the router and are used through the one method that is needed.
 */
type Parser = {
  safeParse: (
    value: unknown,
  ) =>
    | { readonly success: true }
    | { readonly success: false; readonly error: { readonly issues: readonly ParseIssue[] } }
}

type ParseIssue = {
  readonly code: string
  readonly path: readonly PropertyKey[]
  readonly message: string
  /** `unrecognized_keys` carries the keys the strict object refused. */
  readonly keys?: readonly string[]
}

type ProcedureDef = { readonly type: string; readonly output?: Parser }

/* ── the reserved names (`r-trpc-reserved-names`) ─────────────────────────── */

/**
 * The three keys tRPC will not let a router carry, read verbatim out of
 * `@trpc/server@11.18.0`'s own `reservedWords`
 * (`apps/api/node_modules/@trpc/server/dist/tracked-DWInO6EQ.mjs:179-183`): a
 * router is a callable-ish object, so these three collide with
 * `Function.prototype` and with thenable detection.
 *
 * **They are legal TypeScript and illegal tRPC.** A procedure named `apply`
 * typechecks clean in all four packages — the labels lane shipped one, and the
 * only thing that ever said no was `createRouterFactory` at the moment the
 * router was built. The shipped answer is a naming split: the wire procedure is
 * `labels.set` while the App keeps the domain's `labels.apply`
 * (`apps/api/src/trpc/routers/labels.router.ts`), and until now that split was
 * documented in one file's header, which protects one router and nobody else.
 */
const RESERVED = ['then', 'call', 'apply'] as const

/** What every reserved-name finding below points the reader at. */
const RESERVED_ADVICE =
  'tRPC reserves then/call/apply as router keys (@trpc/server 11.18.0 reservedWords) — ' +
  'it is legal TypeScript and illegal tRPC, and it fails when the router is BUILT, not ' +
  'when it is typechecked. Rename the wire procedure and keep the domain verb on the App: ' +
  'the shipped precedent is wire `labels.set` beside App `labels.apply` ' +
  '(apps/api/src/trpc/routers/labels.router.ts; docs/design/trpc.md §Reserved names).'

/**
 * Any enumerated procedure path carrying a reserved segment.
 *
 * Exported because it is the half of this record that a test can drive directly:
 * the shipped router cannot reach here carrying `apply` — tRPC throws first, and
 * `routerBuildFinding` below is what catches that — so a path list is the only
 * way to watch this refusal fire.
 */
export function reservedNameFindings(paths: readonly string[]): Finding[] {
  const findings: Finding[] = []
  for (const path of paths) {
    for (const segment of path.split('.')) {
      if (!(RESERVED as readonly string[]).includes(segment)) continue
      findings.push({
        path,
        problem: `"${segment}" is a reserved tRPC router key. ${RESERVED_ADVICE}`,
      })
    }
  }
  return findings
}

/**
 * A router that refused to build, as a finding.
 *
 * The check below walks the real router's procedure paths, and a reserved name
 * means there are none to walk: `router({ apply: … })` throws
 * `Reserved words used in router({}) call: apply` before a single key
 * exists, so the enumeration this file is built on never happens. Measured, not
 * reasoned — that string is this probe's output against `@trpc/server` 11.18.0:
 *
 *     const inner = t.router({ apply: t.procedure.query(() => 1) })
 *     → THREW at construction: Reserved words used in `router({})` call: apply
 *
 * Without this translation the gate still goes red, and it goes red as an
 * unattributed crash out of `node_modules` — which is the afternoon the record
 * is about. With it, the same red names the class and the precedent.
 */
export function routerBuildFinding(failure: unknown): Finding {
  const message = failure instanceof Error ? failure.message : String(failure)
  if (message.includes('Reserved words used in')) {
    return { path: 'the router', problem: `${message}. ${RESERVED_ADVICE}` }
  }
  return { path: 'the router', problem: `could not be built — ${message}` }
}

/**
 * The real router, or the finding that explains why there is none.
 *
 * Imported dynamically for exactly one reason: a static import of a router that
 * throws at construction takes this whole module down with it, and then nothing
 * in here — including the refusal above — ever runs.
 */
async function loadRouter(): Promise<{
  readonly procedures: Record<string, { _def: ProcedureDef }>
  readonly failure?: Finding
}> {
  try {
    const loaded = (await import('../apps/api/src/trpc/router.ts')) as unknown as {
      appRouter: { _def: { procedures: Record<string, { _def: ProcedureDef }> } }
    }
    return { procedures: loaded.appRouter._def.procedures }
  } catch (failure) {
    return { procedures: {}, failure: routerBuildFinding(failure) }
  }
}

const realRouter = await loadRouter()
const procedures = realRouter.procedures

/** The mock's handlers, reached the one way a caller with no world can reach them. */
type Handler = (input: unknown, emit?: (item: unknown) => void) => unknown
const handlers = mockRouter as unknown as Record<string, Handler>

/* ── the fixture run ──────────────────────────────────────────────────────── */

/**
 * One call each, in an order the world can answer.
 *
 * The world is stateful on purpose (`r-mock-world-semantics`), so the sequence
 * is part of the fixture: the reviewer decides all three records before the
 * finish gate will let `review.finish` answer, and the stream replays from `0`
 * once the writes above it have published something to replay. Every input is
 * `AppRouterInputs`, so a procedure that changes shape breaks this list at
 * compile time rather than passing a check that silently exercised nothing.
 */
type Step = {
  readonly [P in ProcedurePath]: {
    readonly path: P
    readonly why: string
    readonly input: () => InputOf<P>
  }
}[ProcedurePath]

const RETRO = 1
const REVISION = 2
/** The record thread the fixture world opens with. */
const THREAD = 1

/**
 * The two definitions the fixture opens with that this run addresses by id.
 *
 * Safe as literals because the mock mints definition ids **per vocabulary and
 * 1-based**, the way SQLite's own AUTOINCREMENT does per table rather than off
 * the world's shared counter — so an unrelated write cannot move them
 * (`trpc-mock.ts`, the vocabulary fixture).
 */
const LABEL_NEEDS_TRIAGE = 2
const ATTRIBUTE_MOVED_ON = 2

/**
 * The name this run creates, retires, brings back, retires again and then renames
 * away.
 *
 * **The rename is what makes the plan re-runnable**, and it is the only reason
 * that step exists in this order. The gate and this script's own tests call
 * `checkMockParity()` several times against one world, so every act the plan
 * takes it has to take back — and a `define` cannot be taken back, because
 * retiring a label does not free its name (a retired label is still rendering on
 * the records that wear it, so a second label reusing the word would make two
 * classifications read as one thing). Renaming this run's label to something
 * carrying its own id leaves `parity check` free for the next run, which is the
 * one shape of undo a create has.
 *
 * Each step looks the id up by the **stable** name rather than threading it
 * through, because the steps cannot see each other's answers — which is also why
 * the retire runs before the rename: after the rename there is no name left that
 * a later step could name.
 *
 * **The un-retire sits between two retires, and both sides of that sandwich are
 * load-bearing.** It has to run after a retire because un-retiring what is not
 * retired is refused, and a second retire has to run after *it* because the
 * world is stateful and this plan leaves no offerable definition behind — the
 * `mutate before you read` rule read in the other direction, which the fourth
 * lifecycle act already makes the case for below.
 */
const PARITY_NAME = 'parity check'

/** The id of the definition currently called `name`, read out of the world itself. */
function definitionId(path: 'labels.list' | 'attributes.list', name: string): number {
  const list = handlers[path]
  if (list === undefined) throw new Error(`the mock does not cover ${path}`)
  const vocabulary = list({}) as readonly { id: number; name: string }[]
  const found = vocabulary.find((definition) => definition.name === name)
  if (found === undefined) {
    throw new Error(`the fixture world holds no ${path.split('.')[0]} called "${name}"`)
  }
  return found.id
}

/**
 * **This is the third list that pins the procedure set, and it is the one that
 * does it silently** (`r-parity-plan-discipline`).
 *
 * `apps/api/test/procedures.test.ts` and `apps/web/test/procedure-set.spec.ts`
 * both name the twenty-nine out loud, so adding a procedure fails them by name.
 * This one names them too — every path below is a `ProcedurePath`, and the loop
 * at the end of `checkMockParity` refuses any procedure no step calls — but the
 * failure reads "no step in the fixture run calls it" rather than "the list
 * changed". So: **a procedure added to the router is added in three places, and
 * this is the third.**
 *
 * **The order is part of the fixture, not a convenience.** The world is stateful
 * (`r-mock-world-semantics`), so what a read can be checked against is whatever
 * the steps above it have already made true — and the rule that follows is
 * *mutate before you read*. A shape with a populated half and an empty half is
 * only half-checked if the read runs first: the two `records.setLifecycle` acts
 * that populate one run before `records.listAll` for exactly that reason (see
 * the note on them below), and the three verdicts run before `review.finish`
 * because the finish gate will not answer while anything is pending. A step
 * moved upwards can quietly stop checking what it was added to check, without
 * failing anything.
 *
 * **And the rule cuts both ways**, which the fourth lifecycle act is the case
 * for: an act that would *undo* the state a read was added to check has to run
 * after it, so `unarchived` sits below the listing rather than beside its pair.
 * A step moved downwards is as capable of hollowing out a check as one moved up.
 */
const PLAN: readonly Step[] = [
  { path: 'retros.list', why: 'the dashboard row', input: () => ({}) },
  { path: 'retros.get', why: 'the review header', input: () => ({ retroId: RETRO }) },
  { path: 'records.list', why: 'the records column', input: () => ({ retroId: RETRO }) },
  {
    path: 'records.get',
    why: 'the record pane, the deepest shape on the wire',
    input: () => ({ retroId: RETRO, rid: 'r-stale-lock' }),
  },
  /**
   * The lifecycle writes run **before** the flat listing on purpose.
   *
   * A record nobody has touched answers `{status:'open', refs:[], note:null,
   * actor:null, at:null}`, so a listing taken first would validate only the
   * empty half of `recordLifecycleSchema` and an extra field canned into the
   * populated half would sail through. Resolving one record first makes the next
   * answer carry both: one row with every lifecycle field filled in, two with
   * none.
   *
   * The archive below is a **second** record on purpose, rather than a second
   * act on the first one. Archiving supersedes the resolve that came before it
   * and carries no references of its own, so archiving `r-stale-lock` would
   * empty the populated half this step exists to fill — and the listing would be
   * back to checking `refs: []` everywhere.
   */
  {
    path: 'records.setLifecycle',
    why: 'the human marking a record fixed, with its references',
    input: () => ({
      retroId: RETRO,
      rid: 'r-stale-lock',
      status: 'resolved',
      refs: ['a1b2c3d', 'https://github.com/o/r/pull/42'],
      note: 'Landed on main.',
    }),
  },
  {
    path: 'records.setLifecycle',
    why: 'the human putting a record out of the way — the third position on the axis',
    input: () => ({
      retroId: RETRO,
      rid: 'r-silent-tailer',
      status: 'archived',
      note: 'Superseded by the rewrite.',
    }),
  },
  {
    path: 'records.listAll',
    why: 'the flat cross-retro page, carrying all three positions and both halves of the shape',
    input: () => ({}),
  },
  /**
   * The other two acts, **after** the listing that needed the first two
   * standing — and they are what puts the world back.
   *
   * Two rules meet here. *Mutate before you read* put the resolve and the
   * archive above the listing; its converse puts these below it, because an act
   * that **undoes** the state a read was added to check has to wait for that
   * read. And a third rule arrives with them: **every act this plan takes, it
   * takes back.** An act is only legal from the states `LIFECYCLE_ACT_FROM`
   * names, so a plan that left `r-stale-lock` resolved would refuse its own
   * resolve the second time it ran — and `check-mock-parity.test.ts` runs it
   * twice in one process on purpose, because the gate does. A step added here
   * that changes lifecycle state and does not undo it will fail that test rather
   * than the next reader.
   */
  {
    path: 'records.setLifecycle',
    why: 'the human bringing an archived record back — and the world with it',
    input: () => ({ retroId: RETRO, rid: 'r-silent-tailer', status: 'unarchived' }),
  },
  {
    path: 'records.setLifecycle',
    why: 'the fix that did not hold — and the resolve above, taken back',
    input: () => ({ retroId: RETRO, rid: 'r-stale-lock', status: 'reopened' }),
  },
  { path: 'threads.list', why: 'the comments panel', input: () => ({ retroId: RETRO }) },
  {
    path: 'threads.open',
    why: 'a new record-level thread',
    input: () => ({
      retroId: RETRO,
      target: { kind: 'record', rid: 'r-silent-tailer', section: 'solutions' },
      text: 'Does the parity check see this answer?',
    }),
  },
  {
    path: 'threads.reply',
    why: 'a reply into the fixture thread',
    input: () => ({ threadId: THREAD, text: 'And this one.' }),
  },
  {
    path: 'threads.resolve',
    why: 'the human settling a thread',
    input: () => ({ threadId: THREAD, resolved: true }),
  },
  {
    path: 'decisions.record',
    why: 'a verdict on a record that proposes solutions',
    input: () => ({
      retroId: RETRO,
      rid: 'r-stale-lock',
      revision: REVISION,
      state: 'approved',
      selectedSolution: 1,
    }),
  },
  {
    path: 'decisions.record',
    why: 'a verdict on a record that proposes none',
    input: () => ({
      retroId: RETRO,
      rid: 'r-bullet-responses',
      revision: REVISION,
      state: 'approved',
      solutionLevel: 2,
    }),
  },
  {
    path: 'decisions.record',
    why: 'the last pending record, so the finish gate opens',
    input: () => ({
      retroId: RETRO,
      rid: 'r-silent-tailer',
      revision: REVISION,
      state: 'declined',
    }),
  },
  {
    path: 'review.finish',
    why: 'the terminal act, once nothing is pending',
    input: () => ({ retroId: RETRO }),
  },
  /**
   * **The record page, last of the reads, and that placement is the whole
   * point.**
   *
   * Its answer carries a `timeline`, which is a list — and an empty list is
   * accepted by `z.array(...)` without a single element ever meeting the schema
   * inside it. A record nobody has touched has one `created` line, so a step run
   * near the top of this plan would have validated one arm of a three-arm
   * discriminated union and left `decision` and `lifecycle` — the two that carry
   * a state, an actor, a version, references and a note — checked by nothing.
   *
   * So it runs after every write above it: after the four lifecycle acts, which
   * put two `lifecycle` lines on this record's history whether or not they left
   * it back where they found it (the table is append-only, so an act taken back
   * is still an act taken), and after the three verdicts, which put a `decision`
   * line on it. `r-stale-lock` is the record they were all taken on, so its
   * timeline is the one place in this run where all three arms are on one
   * answer.
   *
   * The same *mutate before you read* rule that put the lifecycle writes above
   * `records.listAll`, one shape deeper: there, the empty half was a record's
   * lifecycle fields; here it is a whole arm of a union.
   */
  /**
   * **The two vocabularies, and what records wear from them.**
   *
   * The three reads run first here rather than last, and that is not the
   * *mutate-before-you-read* rule being ignored — it is the rule being already
   * satisfied by the fixture. A definition's one nullable field is `retiredAt`,
   * and the world opens holding a retired label and a retired attribute, so both
   * halves of `labelDefinitionSchema` and `attributeDefinitionSchema` are
   * checked before this plan writes anything. The same is true one level down:
   * two records open wearing labels and one opens carrying two values, which is
   * what makes the `records.get`, `records.listAll` and `records.byId` steps
   * elsewhere in this plan validate a populated `labels` and `attributes` rather
   * than an empty array that no row schema ever sees inside.
   *
   * What the writes below are for is the answers *they* produce, and every one
   * of them puts the world back — see `PARITY_NAME` for the one act whose undo
   * is a rename rather than its own inverse.
   */
  { path: 'labels.list', why: 'the settings page’s label vocabulary', input: () => ({}) },
  { path: 'attributes.list', why: 'and its attribute vocabulary', input: () => ({}) },
  {
    path: 'settings.get',
    why: 'the AI-config-write toggle, as the page reads it',
    input: () => ({}),
  },
  {
    path: 'settings.setAiConfigWrite',
    why: 'the human granting the AI config writes',
    input: () => ({ enabled: true }),
  },
  {
    path: 'settings.setAiConfigWrite',
    why: 'and taking it back — the world as it was, and the state a fresh install is in',
    input: () => ({ enabled: false }),
  },
  {
    path: 'labels.define',
    why: 'a label created from the settings page',
    input: () => ({ name: PARITY_NAME }),
  },
  {
    path: 'labels.retire',
    why: 'retired, so this run leaves no offerable label behind — and before the rename, which is what the retire addresses it by',
    input: () => ({ id: definitionId('labels.list', PARITY_NAME) }),
  },
  {
    path: 'labels.unretire',
    why: 'brought back, so the answer carries a definition whose retiredAt is null after having been set — and it must follow the retire, which is the only state it is accepted from',
    input: () => ({ id: definitionId('labels.list', PARITY_NAME) }),
  },
  {
    path: 'labels.retire',
    why: 'retired again, because the un-retire above undid the state this run has to leave behind',
    input: () => ({ id: definitionId('labels.list', PARITY_NAME) }),
  },
  {
    path: 'labels.rename',
    why: 'renamed onto a name only this run can hold, which frees PARITY_NAME for the next one',
    input: () => {
      const id = definitionId('labels.list', PARITY_NAME)
      return { id, name: `${PARITY_NAME} ${id}` }
    },
  },
  {
    path: 'attributes.define',
    why: 'an attribute created from the settings page, with the type that makes it queryable',
    input: () => ({ name: PARITY_NAME, type: 'url' }),
  },
  {
    path: 'attributes.retire',
    why: 'the same three-act cycle one table over',
    input: () => ({ id: definitionId('attributes.list', PARITY_NAME) }),
  },
  {
    path: 'attributes.unretire',
    why: 'the same sandwich one table over — and this answer is the one that proves the type survives a round trip',
    input: () => ({ id: definitionId('attributes.list', PARITY_NAME) }),
  },
  {
    path: 'attributes.retire',
    why: 'retired again, leaving the world as this run found it',
    input: () => ({ id: definitionId('attributes.list', PARITY_NAME) }),
  },
  {
    path: 'attributes.rename',
    why: 'and the rename that frees the name again',
    input: () => {
      const id = definitionId('attributes.list', PARITY_NAME)
      return { id, name: `${PARITY_NAME} ${id}` }
    },
  },
  /**
   * The record writes, on a record the fixture leaves bare — so the *applied*
   * answer carries a row and the *removed* answer carries the empty array, and
   * both halves of the result shape are checked by one pair of steps.
   */
  {
    path: 'labels.set',
    why: 'the human putting a label on a record',
    input: () => ({
      retroId: RETRO,
      rid: 'r-silent-tailer',
      labelId: LABEL_NEEDS_TRIAGE,
      applied: true,
    }),
  },
  {
    path: 'labels.set',
    why: 'and taking it off, which puts the world back',
    input: () => ({
      retroId: RETRO,
      rid: 'r-silent-tailer',
      labelId: LABEL_NEEDS_TRIAGE,
      applied: false,
    }),
  },
  {
    path: 'attributes.set',
    why: 'a value on a record, validated against its definition’s type',
    input: () => ({
      retroId: RETRO,
      rid: 'r-silent-tailer',
      attributeId: ATTRIBUTE_MOVED_ON,
      value: '2026-09-01',
    }),
  },
  {
    path: 'attributes.set',
    why: 'cleared — the one input on this wire whose absence means an act, and the undo of the step above',
    input: () => ({ retroId: RETRO, rid: 'r-silent-tailer', attributeId: ATTRIBUTE_MOVED_ON }),
  },
  /**
   * **The relation, related before the record page reads and un-related after
   * it** — both halves of the *mutate before you read* rule in one pair, and the
   * pair is what puts the world back.
   *
   * `#1` is already the far end of the relation the fixture opens holding, so
   * `records.byId` below would validate a populated `relations` array either way;
   * what this step adds is the **other** direction on the same answer, so the
   * `outgoing` arm and the `incoming` arm are both checked by one read rather
   * than whichever one the fixture happened to seed.
   */
  {
    path: 'records.relate',
    why: 'the human relating two records, in the words the act carries',
    input: () => ({ fromId: 1, toId: 2, related: true, how: 'the parity check’s own relation' }),
  },
  {
    path: 'records.byId',
    why: 'the record page, whose timeline is empty of everything interesting until the writes above have run — and whose relations carry both directions only once the step above has run',
    input: () => ({ id: 1 }),
  },
  {
    path: 'records.relate',
    why: 'and taken off again — the undo, which has to follow the read it was added for',
    input: () => ({ fromId: 1, toId: 2, related: false }),
  },
  /**
   * **The record an agent is holding** — the only step in this run whose answer
   * carries a populated `claim`, and the reason it is a second `records.byId`
   * rather than an assertion on the first.
   *
   * `claim` is null until somebody takes the record, and **no procedure can take
   * one**: the claim is written through the CLI in the AI's own process and this
   * wire carries only the reading (`views.schema.ts` §recordClaimSchema). So the
   * *mutate before you read* rule cannot be satisfied by ordering here — the
   * fixture world opens holding the claim instead (`trpc-mock.ts`
   * §OPENING_CLAIMS), and this step is what hands the populated half to the
   * strict schema. Without it every `claim` in this run is null and a field
   * canned inside the object would sail through at the one depth this check
   * exists for.
   *
   * `#7` is that record — `r-ipad-scroll` of the third retrospective, approved
   * and open in a finished round, which is what a queue record looks like. It is
   * also the only `records.byId` call in this plan that reads a retrospective
   * other than the one under review.
   */
  {
    path: 'records.byId',
    why: 'the record page of a record somebody is holding — the populated half of the claim, which no procedure in this run can create',
    input: () => ({ id: 7 }),
  },
  {
    path: 'events.onRetro',
    why: 'the stream, replaying everything the steps above published',
    input: () => ({ retroId: RETRO, lastEventId: '0' }),
  },
]

/* ── the check ────────────────────────────────────────────────────────────── */

export type Finding = { readonly path: string; readonly problem: string }

/**
 * `events.onRetro` declares no `.output()` — tRPC validates a subscription's
 * yielded value as the `tracked()` envelope rather than the payload inside it,
 * so declaring one would reject every event (`events.router.ts`). The envelope
 * is tRPC's shape, checked here by its two keys; the payload inside it is ours,
 * and gets the api's own schema like every other answer.
 */
const TRACKED_KEYS = ['id', 'data'].sort().join(',')

function describe(issues: readonly ParseIssue[]): string {
  return issues
    .map((issue) => {
      const where = issue.path.length === 0 ? 'the answer' : issue.path.join('.')
      const extra = issue.keys === undefined ? '' : `: ${issue.keys.join(', ')}`
      return `${where} — ${issue.message}${extra} [${issue.code}]`
    })
    .join('; ')
}

function validate(path: string, answer: unknown, parser: Parser): Finding[] {
  const result = parser.safeParse(answer)
  if (result.success) return []
  return [{ path, problem: describe(result.error.issues) }]
}

function checkStream(path: string, run: Handler, input: unknown): Finding[] {
  const emitted: unknown[] = []
  const stop = run(input, (item) => emitted.push(item))
  if (typeof stop === 'function') (stop as () => void)()

  if (emitted.length === 0) {
    return [{ path, problem: 'the stream yielded nothing, so no answer was checked' }]
  }

  const findings: Finding[] = []
  for (const item of emitted) {
    const keys = Object.keys(item as object).sort()
    if (keys.join(',') !== TRACKED_KEYS) {
      findings.push({ path, problem: `the tracked envelope carries ${keys.join(', ')}` })
      continue
    }
    findings.push(
      ...validate(path, (item as { data: unknown }).data, wireEventSchema as unknown as Parser),
    )
  }
  return findings
}

/**
 * Runs the plan and validates every answer. `router` is a seam for the tests:
 * they pass a stand-in that cans one extra field and watch this fail.
 */
export function checkMockParity(router: Record<string, Handler> = handlers): Finding[] {
  const findings: Finding[] = []

  // Before anything is enumerated, because a router that would not build has
  // nothing to enumerate (`r-trpc-reserved-names`).
  if (realRouter.failure !== undefined) return [realRouter.failure]

  const mocked = Object.keys(router).sort()
  const real = Object.keys(procedures).sort()

  // Both sides, and ahead of the set comparison below: a reserved segment is a
  // finding about the NAME, and reporting it as "the mock covers …; the router
  // declares …" would bury it in two sorted lists nobody diffs by eye.
  const reserved = reservedNameFindings([...new Set([...mocked, ...real])])
  if (reserved.length > 0) return reserved

  if (mocked.join(',') !== real.join(',')) {
    findings.push({
      path: 'the router',
      problem: `the mock covers ${mocked.join(', ')}; the router declares ${real.join(', ')}`,
    })
    return findings
  }

  const exercised = new Set<string>()
  for (const step of PLAN) {
    const definition = procedures[step.path]?._def
    const run = router[step.path]
    if (definition === undefined || run === undefined) {
      findings.push({ path: step.path, problem: 'no such procedure' })
      continue
    }
    exercised.add(step.path)

    let answer: unknown
    try {
      if (definition.type === 'subscription') {
        findings.push(...checkStream(step.path, run, step.input()))
        continue
      }
      answer = run(step.input())
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure)
      findings.push({ path: step.path, problem: `refused the fixture call — ${message}` })
      continue
    }

    if (definition.output === undefined) {
      findings.push({
        path: step.path,
        problem: 'declares no .output() schema, so its answer cannot be checked here',
      })
      continue
    }
    findings.push(...validate(step.path, answer, definition.output))
  }

  for (const path of real) {
    if (exercised.has(path)) continue
    findings.push({ path, problem: 'no step in the fixture run calls it' })
  }

  return findings
}

if (import.meta.main) {
  const findings = checkMockParity()

  if (findings.length > 0) {
    console.error(`mock-parity: FAIL — ${findings.length} finding(s)`)
    for (const finding of findings) {
      console.error(`  ${finding.path}  ${finding.problem}`)
    }
    console.error(
      '  A field the world does not model is never canned — apps/web/test/trpc-mock.ts.',
    )
    console.error('  See docs/design/testing.md §R-MOCK-LOCK.')
    process.exit(1)
  }

  const paths = Object.keys(procedures).length
  console.log(
    `mock-parity: OK — ${PLAN.length} call(s) over ${paths} procedure(s), every answer accepted by the router's own output schema`,
  )
}
