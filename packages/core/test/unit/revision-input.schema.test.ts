import { describe, expect, test } from 'bun:test'
import { parseRevisionInput } from '#application/schemas/revision-input.schema'
import { ValidationError } from '#domain/errors/validation.error'
import { aRecordInput, aRevisionInput, someSolutions } from '../support/fixtures'

/** Parses a revision built from one record with `overrides` applied. */
function parseWith(overrides: Record<string, unknown>): unknown {
  return parseRevisionInput({ records: [{ ...aRecordInput(), ...overrides }] })
}

function expectRejected(overrides: Record<string, unknown>, expectedPath: string): void {
  try {
    parseWith(overrides)
    throw new Error(`expected ${expectedPath} to be rejected`)
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError)
    expect((error as ValidationError).issues.map((issue) => issue.path)).toContain(expectedPath)
  }
}

describe('revision schema — the mechanical half of D5', () => {
  test('accepts a well-formed revision', () => {
    expect(parseRevisionInput(aRevisionInput([{}, {}]))).toBeDefined()
  })

  test('rejects anything that is not a revision at all', () => {
    expect(() => parseRevisionInput(undefined)).toThrow(ValidationError)
    expect(() => parseRevisionInput({ records: 'nope' })).toThrow(ValidationError)
    expect(() => parseRevisionInput({})).toThrow(ValidationError)
  })

  /**
   * The retrospective's own name (KC-0020, ledger v2 #120). Optional, because a
   * draft without one still reads; capped, because it is a name on a row and not
   * a summary; trimmed, because a title padded with whitespace is a title that
   * sorts and renders wrong for a reason nobody can see.
   */
  describe('the retro title', () => {
    const parseTitled = (title: unknown) =>
      parseRevisionInput({ title, records: [aRecordInput()] }) as { title?: string }

    test('is optional, and absent stays absent rather than becoming ""', () => {
      expect(parseRevisionInput(aRevisionInput()).title).toBeUndefined()
      expect(parseTitled(undefined).title).toBeUndefined()
    })

    test('is trimmed, and must say something once it has been', () => {
      expect(parseTitled('  The lock that outlived its process  ').title).toBe(
        'The lock that outlived its process',
      )
      expect(() => parseTitled('   ')).toThrow(ValidationError)
      expect(() => parseTitled('')).toThrow(ValidationError)
    })

    test('stops at 80 characters — it is a name, not a summary', () => {
      expect(parseTitled('x'.repeat(80)).title).toHaveLength(80)
      expect(() => parseTitled('x'.repeat(81))).toThrow(ValidationError)
    })

    test('is a string or nothing', () => {
      expect(() => parseTitled(3)).toThrow(ValidationError)
    })
  })

  test('rejects unknown keys — a typo must not be silently dropped', () => {
    expect(() => parseRevisionInput({ records: [], extra: true })).toThrow(ValidationError)
    expectRejected({ sevrity: 3 }, 'records.0')
  })

  test('requires every field of the record', () => {
    expectRejected({ title: undefined }, 'records.0.title')
    expectRejected({ problem: undefined }, 'records.0.problem')
    expectRejected({ solutions: undefined }, 'records.0.solutions')
    expectRejected({ humanWords: undefined }, 'records.0.humanWords')
    expectRejected({ defaults: undefined }, 'records.0.defaults')
  })

  /**
   * The write path narrowed and the read path did not (data-model.md §Hold).
   * A draft still written in the old shape is refused with the unrecognized keys
   * named, rather than accepted and stored as a record nothing can render the
   * new way — while every revision already holding those keys keeps them.
   */
  test('refuses a draft still written as a direction and a footprint', () => {
    expect(() =>
      parseRevisionInput({
        records: [
          {
            ...aRecordInput(),
            agreedDirection: 'Write the holder PID into the lock. (agreed)',
            footprint: '- lib/lock.ts',
          },
        ],
      }),
    ).toThrow(ValidationError)
  })

  test('rejects empty strings where presence is the rule', () => {
    expectRejected({ title: '   ' }, 'records.0.title')
    expectRejected({ problem: '' }, 'records.0.problem')
  })

  test('validates each solution’s footprint for presence only — its layout is instructed', () => {
    expectRejected(
      { solutions: someSolutions([{ footprint: '' }]) },
      'records.0.solutions.0.footprint',
    )
    expect(
      parseWith({ solutions: someSolutions([{ footprint: 'anything at all' }]) }),
    ).toBeDefined()
  })

  test('requires a workaround — free text or the literal "none"', () => {
    expectRejected({ workaround: '' }, 'records.0.workaround')
    expectRejected({ workaround: undefined }, 'records.0.workaround')
    expect(parseWith({ workaround: 'none' })).toBeDefined()
  })

  test('requires both halves of every quote', () => {
    expectRejected(
      { humanWords: [{ verbatim: 'as spoken', cleaned: '' }] },
      'records.0.humanWords.0.cleaned',
    )
    expectRejected({ humanWords: [{ cleaned: 'tidied' }] }, 'records.0.humanWords.0.verbatim')
    // Context is the one optional half.
    expect(parseWith({ humanWords: [{ verbatim: 'a', cleaned: 'A.' }] })).toBeDefined()
    // A record with nothing quotable is allowed; an *absent* key is not.
    expect(parseWith({ humanWords: [] })).toBeDefined()
  })

  test('requires a five-whys chain of one to five links with a root', () => {
    expectRejected(
      { rootCause: { whatHappened: 'x', whys: [], root: 'y' } },
      'records.0.rootCause.whys',
    )
    expectRejected(
      { rootCause: { whatHappened: 'x', whys: ['1', '2', '3', '4', '5', '6'], root: 'y' } },
      'records.0.rootCause.whys',
    )
    expectRejected(
      { rootCause: { whatHappened: 'x', whys: ['1'], root: '' } },
      'records.0.rootCause.root',
    )
    expectRejected(
      { rootCause: { whatHappened: '', whys: ['1'], root: 'y' } },
      'records.0.rootCause.whatHappened',
    )
  })

  test('holds every enum to its range', () => {
    expectRejected({ type: 'bug' }, 'records.0.type')
    expectRejected({ requester: 'someone-else' }, 'records.0.requester')
    expectRejected({ defaults: { severity: 6 } }, 'records.0.defaults.severity')
    expectRejected(
      { solutions: someSolutions([{ level: 9 as never }]) },
      'records.0.solutions.0.level',
    )
    expectRejected(
      { defaults: { severity: 3, involvement: 'sometimes' } },
      'records.0.defaults.involvement',
    )
  })

  test('defaults involvement to undecided — never to a real mode of working', () => {
    const parsed = parseWith({ defaults: { severity: 4 } }) as {
      records: { defaults: { involvement: string } }[]
    }

    expect(parsed.records[0]?.defaults.involvement).toBe('undecided')
  })

  test('requires a proposed severity — there is no sensible default for judgment', () => {
    expectRejected({ defaults: { involvement: 'autonomous' } }, 'records.0.defaults.severity')
  })

  test('refuses a solution level beside the solutions — the record proposes one per solution', () => {
    expectRejected({ defaults: { severity: 3, solutionLevel: 2 } }, 'records.0.defaults')
  })

  /**
   * The owner's design, as mechanical rules: *"the AI should do deep-dive and
   * propose solutions (up to 3). In some places only 1-2 might make sense when it
   * is a quick fix"*, *"It should always be sorted from lower level solution to
   * high level solution"*, and *"some indication like a `*` that shows what is
   * solution recommended by the AI"*.
   *
   * Order and the single recommendation are validated rather than instructed
   * because both are load-bearing at the other end: the human's pick is stored as
   * a **position** into this array, and the recommended one is what a reviewer who
   * touches nothing is taken to have accepted.
   */
  describe('the solutions a draft proposes', () => {
    const withSolutions = (solutions: unknown) => parseWith({ solutions })

    test('is one to three of them', () => {
      const [first] = someSolutions()
      expect(withSolutions([{ ...first, recommended: true }])).toBeDefined()
      expectRejected({ solutions: [] }, 'records.0.solutions')
      expectRejected(
        {
          solutions: [
            ...someSolutions(),
            { bullets: '- **A third.**', footprint: 'x.ts', level: 3, recommended: false },
            { bullets: '- **A fourth.**', footprint: 'y.ts', level: 4, recommended: false },
          ],
        },
        'records.0.solutions',
      )
    })

    test('runs from the lowest level to the highest, ties keeping their order', () => {
      expectRejected(
        { solutions: someSolutions([{ level: 4 }, { level: 2, recommended: true }]) },
        'records.0.solutions.1.level',
      )
      expect(
        withSolutions(someSolutions([{ level: 2 }, { level: 2, recommended: true }])),
      ).toBeDefined()
    })

    test('marks exactly one of them recommended', () => {
      expectRejected(
        { solutions: someSolutions([{ recommended: false }, { recommended: false }]) },
        'records.0.solutions',
      )
      expectRejected(
        { solutions: someSolutions([{ recommended: true }, { recommended: true }]) },
        'records.0.solutions',
      )
    })

    test('holds each level to the five KC-0021 left', () => {
      for (const level of [1, 2, 3, 4, 5] as const) {
        expect(
          withSolutions(someSolutions([{ level: 1 }, { level, recommended: true }])),
        ).toBeDefined()
      }
      for (const cut of ['none', 'upstream', 'undecided']) {
        // Cast, because the type already refuses these — the assertion is that
        // the *runtime* refuses them too, for a draft that never saw the type.
        expectRejected(
          { solutions: someSolutions([{ level: cut as never }]) },
          'records.0.solutions.0.level',
        )
      }
    })

    test('wants words and a footprint in every one of them', () => {
      expectRejected(
        { solutions: someSolutions([{ bullets: '  ' }]) },
        'records.0.solutions.0.bullets',
      )
      expectRejected(
        { solutions: someSolutions([{ footprint: '' }]) },
        'records.0.solutions.0.footprint',
      )
    })

    test('rejects an unknown key inside a solution', () => {
      expectRejected(
        { solutions: someSolutions([{ tab: 'Solution 1' } as never]) },
        'records.0.solutions.0',
      )
    })
  })

  test('holds the rid to the r-<words> slug shape', () => {
    expectRejected({ rid: 'deploy-blocked' }, 'records.0.rid')
    expectRejected({ rid: 'r-Deploy_Blocked' }, 'records.0.rid')
    expect(parseWith({ rid: 'r-a1-b2' })).toBeDefined()
  })

  test('rejects a rid or a num used twice in one revision', () => {
    expect(() =>
      parseRevisionInput({
        records: [aRecordInput({ rid: 'r-same', num: 1 }), aRecordInput({ rid: 'r-same', num: 2 })],
      }),
    ).toThrow(ValidationError)
    expect(() =>
      parseRevisionInput({
        records: [aRecordInput({ rid: 'r-one', num: 1 }), aRecordInput({ rid: 'r-two', num: 1 })],
      }),
    ).toThrow(ValidationError)
  })

  test('says nothing about style — the instructed rules are not enforced here', () => {
    // Bold-lead phrasing, computable-cost wording, systemic root causes and
    // footprint tree layout are judgment (D5). A validator for them would be
    // theater: it would pass this and fail good writing that reads differently.
    expect(
      parseWith({
        problem: 'it broke',
        solutions: someSolutions([{ bullets: 'fix it', footprint: 'somewhere' }]),
        rootCause: { whatHappened: 'it broke', whys: ['because'], root: 'reasons' },
      }),
    ).toBeDefined()
  })

  test('reports every issue it found, not just the first', () => {
    try {
      parseRevisionInput({ records: [{ ...aRecordInput(), title: '', problem: '' }] })
      throw new Error('expected a rejection')
    } catch (error) {
      expect((error as ValidationError).issues.length).toBeGreaterThanOrEqual(2)
      expect((error as ValidationError).message).toContain('more')
    }
  })
})
