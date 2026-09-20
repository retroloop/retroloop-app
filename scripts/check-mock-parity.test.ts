import { describe, expect, test } from 'bun:test'
import { mockRouter } from '../apps/web/test/trpc-mock.ts'
import { checkMockParity, reservedNameFindings, routerBuildFinding } from './check-mock-parity.ts'

/**
 * The direction `satisfies MockRouter` cannot see (`r-mock-extra-field-blind`).
 *
 * Both directions matter, as everywhere else in this file's neighbours: the
 * shipped mock passes, and a mock one field wider than the router does not. The
 * stand-in routers below wrap the real handlers rather than replacing them, so
 * what is under test is the extra field and nothing else about the answer.
 */

type Handler = (input: unknown, emit?: (item: unknown) => void) => unknown

const real = mockRouter as unknown as Record<string, Handler>

/** The shipped mock with one procedure's answer passed through `doctor`. */
function canning(path: string, doctor: (answer: unknown) => unknown): Record<string, Handler> {
  const handler = real[path] as Handler
  return { ...real, [path]: (input) => doctor(handler(input)) }
}

function problemsFor(path: string, findings: readonly { path: string; problem: string }[]): string {
  return findings
    .filter((finding) => finding.path === path)
    .map((finding) => finding.problem)
    .join(' | ')
}

describe('check-mock-parity', () => {
  test('the shipped mock answers what the router promises', () => {
    expect(checkMockParity()).toEqual([])
  })

  test('the world it runs against survives being run twice', () => {
    // The world is stateful by design, and the plan writes to it — a check that
    // only passed on a fresh module would fail the second time the gate ran it
    // in one process, which is exactly how its own tests run it.
    expect(checkMockParity()).toEqual([])
    expect(checkMockParity()).toEqual([])
  })

  test('an extra canned field in an answer is caught', () => {
    // The original repro, as a gate finding: this is the shape that compiles
    // clean under `satisfies MockRouter` and reads as evidence in a scenario.
    const findings = checkMockParity(
      canning('retros.get', (answer) => ({ ...(answer as object), reviewerName: 'Sample' })),
    )

    expect(problemsFor('retros.get', findings)).toContain('unrecognized_keys')
    expect(problemsFor('retros.get', findings)).toContain('reviewerName')
    expect(findings).toHaveLength(1)
  })

  test('an extra field nested inside an answer is caught', () => {
    // The D1 finding's shape: a derived field re-canned deep in the record pane,
    // where a hand-written top-level key set would never have looked.
    const findings = checkMockParity(
      canning('records.get', (answer) => {
        const detail = answer as { record: object }
        return { ...detail, record: { ...detail.record, solutionLevel: 3 } }
      }),
    )

    expect(problemsFor('records.get', findings)).toContain('record — Unrecognized key')
    expect(problemsFor('records.get', findings)).toContain('solutionLevel')
  })

  test('an extra field inside a list row is caught', () => {
    const findings = checkMockParity(
      canning('threads.list', (answer) => {
        const [first, ...rest] = answer as object[]
        return [{ ...first, unread: true }, ...rest]
      }),
    )

    expect(problemsFor('threads.list', findings)).toContain('unread')
  })

  test('an extra field on a streamed event is caught', () => {
    const findings = checkMockParity({
      ...real,
      'events.onRetro': (input, emit) =>
        (real['events.onRetro'] as Handler)(input, (item) => {
          const tracked = item as { id: string; data: object }
          emit?.({ ...tracked, data: { ...tracked.data, seen: false } })
        }),
    })

    expect(problemsFor('events.onRetro', findings)).toContain('seen')
  })

  test('a mistyped field is caught alongside the extra ones', () => {
    const findings = checkMockParity(
      canning('review.finish', (answer) => ({ ...(answer as object), revision: 'two' })),
    )

    expect(problemsFor('review.finish', findings)).toContain('revision')
  })

  test('a procedure the mock stopped covering is caught', () => {
    const { 'threads.resolve': _dropped, ...rest } = real

    const findings = checkMockParity(rest)

    expect(problemsFor('the router', findings)).toContain('threads.resolve')
  })

  test('a procedure that refuses the fixture call is a finding, not a crash', () => {
    const findings = checkMockParity({
      ...real,
      'records.list': () => {
        throw new Error('no such revision')
      },
    })

    expect(problemsFor('records.list', findings)).toContain('refused the fixture call')
    expect(problemsFor('records.list', findings)).toContain('no such revision')
  })
})

/**
 * The runtime-only naming trap (`r-trpc-reserved-names`).
 *
 * `then`, `call` and `apply` are legal TypeScript and illegal tRPC, and the
 * refusal happens when the router is BUILT — so the two halves are tested apart:
 * the segment scan against a path list, because the shipped router can never
 * reach it carrying one, and the build translation against the message tRPC
 * actually throws, quoted from a probe run against @trpc/server 11.18.0.
 */
describe('reserved tRPC router keys', () => {
  test('the shipped procedure set carries none of them', () => {
    expect(reservedNameFindings(Object.keys(real))).toEqual([])
  })

  test('a leaf named apply is refused, and the refusal names the precedent', () => {
    const [finding, ...rest] = reservedNameFindings(['labels.apply'])

    expect(rest).toEqual([])
    expect(finding?.path).toBe('labels.apply')
    expect(finding?.problem).toContain('"apply" is a reserved tRPC router key')
    expect(finding?.problem).toContain('labels.set')
    expect(finding?.problem).toContain('docs/design/trpc.md')
  })

  test('a namespace named then is refused too — every segment is walked', () => {
    expect(reservedNameFindings(['then.list'])).toHaveLength(1)
    expect(reservedNameFindings(['records.call'])).toHaveLength(1)
    expect(reservedNameFindings(['labels.set', 'attributes.set'])).toEqual([])
  })

  test('the check refuses a reserved name before it reports the set mismatch', () => {
    // Reported as a naming finding rather than buried in two sorted lists: the
    // set comparison would answer "the mock covers …; the router declares …",
    // which is the diff nobody reads by eye.
    const findings = checkMockParity({ ...real, 'labels.apply': real['labels.set'] as Handler })

    expect(findings).toHaveLength(1)
    expect(findings[0]?.path).toBe('labels.apply')
    expect(findings[0]?.problem).toContain('reserved tRPC router key')
  })

  test("tRPC's own construction failure becomes this check's finding", () => {
    // Verbatim from a probe against @trpc/server 11.18.0:
    //   t.router({ apply: t.procedure.query(() => 1) })
    //   → THREW at construction: Reserved words used in `router({})` call: apply
    const finding = routerBuildFinding(new Error('Reserved words used in `router({})` call: apply'))

    expect(finding.path).toBe('the router')
    expect(finding.problem).toContain('Reserved words used in')
    expect(finding.problem).toContain('labels.set')
  })

  test('any other build failure is reported as itself, not as a naming problem', () => {
    const finding = routerBuildFinding(new Error('Cannot find module zod'))

    expect(finding.problem).toContain('could not be built')
    expect(finding.problem).toContain('Cannot find module zod')
    expect(finding.problem).not.toContain('reserved')
  })
})
