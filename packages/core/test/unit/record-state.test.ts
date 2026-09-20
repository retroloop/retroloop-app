import { describe, expect, test } from 'bun:test'
import type { Decision } from '#domain/models/decision.model'
import { hashRecordContent } from '#domain/services/content-hash.service'
import { effectiveDecision, pendingRids } from '#domain/services/record-state.service'
import { aRecord } from '../support/fixtures'

function aDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: 1,
    retroId: 1,
    rid: 'r-deploy-blocked',
    version: 1,
    state: 'approved',
    severity: 2,
    solutionLevel: 3,
    selectedSolution: 2,
    involvement: 'interactive',
    reviewerNote: 'Do this one first.',
    revisionN: 1,
    contentHash: hashRecordContent(aRecord()),
    decidedAt: '2026-08-23T10:00:00.000Z',
    ...overrides,
  }
}

describe('effective decision', () => {
  test('an undecided record is pending, showing the AI’s proposals', () => {
    const view = effectiveDecision(aRecord(), 1, undefined)

    expect(view.state).toBe('pending')
    expect(view.severity).toBe(3)
    expect(view.solutionLevel).toBe(2)
    expect(view.involvement).toBe('pull-request')
    expect(view.reviewerNote).toBeUndefined()
    expect(view.decidedOnRevision).toBeUndefined()
  })

  test('a decision on the current revision holds, with the human’s values', () => {
    const view = effectiveDecision(aRecord(), 1, aDecision())

    expect(view.state).toBe('approved')
    expect(view.severity).toBe(2)
    expect(view.involvement).toBe('interactive')
    expect(view.reviewerNote).toBe('Do this one first.')
    expect(view.decidedOnRevision).toBe(1)
    expect(view.carriedOver).toBe(false)
  })

  test('unchanged content carries the decision into the next revision', () => {
    const view = effectiveDecision(aRecord(), 2, aDecision({ revisionN: 1 }))

    expect(view.state).toBe('approved')
    expect(view.decidedOnRevision).toBe(1)
    expect(view.carriedOver).toBe(true)
  })

  /**
   * What a content-changed record actually reads as, field by field — SKILL.md
   * tells the drafting AI it is "exactly like a record they never touched", and
   * that sentence is what stops it reporting a withdrawn verdict back to the
   * human as though it still stood.
   */
  test('a content-changed record shows the AI’s proposals again, all of them', () => {
    const rewritten = aRecord({ problem: 'A materially different problem statement.' })
    const view = effectiveDecision(rewritten, 2, aDecision({ revisionN: 1, selectedSolution: 1 }))

    expect(view.state).toBe('pending')
    expect(view.decidedOnRevision).toBeUndefined()
    expect(view.reviewerNote).toBeUndefined()
    expect(view.severity).toBe(3)
    expect(view.involvement).toBe('pull-request')
    // The pick goes with the verdict even though `solutions` was untouched: the
    // selection is read off a decision that no longer binds.
    expect(view.selectedSolution).toBe(2)
    expect(view.solutionLevel).toBe(2)
  })

  /**
   * The binding is a hash, not a one-way door. SKILL.md tells the AI that
   * restoring a record's content restores the verdict, which is the whole reason
   * it is told to leave untouched records alone — an unasked-for "improvement"
   * is a verdict somebody has to win back.
   */
  test('restoring the content restores the verdict it lost', () => {
    const decision = aDecision({ revisionN: 1 })
    const rewritten = aRecord({ problem: 'A materially different problem statement.' })

    expect(effectiveDecision(rewritten, 2, decision).state).toBe('pending')
    // Revision 3 files it byte-identical to what they decided again.
    const restored = effectiveDecision(aRecord(), 3, decision)
    expect(restored.state).toBe('approved')
    expect(restored.carriedOver).toBe(true)
    expect(restored.decidedOnRevision).toBe(1)
  })

  test('changed content resets the record to pending — and says what it was decided on', () => {
    const rewritten = aRecord({ problem: 'A materially different problem statement.' })
    const view = effectiveDecision(rewritten, 2, aDecision({ revisionN: 1 }))

    expect(view.state).toBe('pending')
    expect(view.contentChangedSince).toBe(1)
    expect(view.decidedOnRevision).toBeUndefined()
    // Back to the AI's proposals: the human's numbers were for content that is gone.
    expect(view.severity).toBe(3)
  })

  test('a decline carries over exactly like an approval — decline is a state', () => {
    const view = effectiveDecision(aRecord(), 3, aDecision({ state: 'declined', revisionN: 1 }))

    expect(view.state).toBe('declined')
    expect(view.carriedOver).toBe(true)
  })
})

describe('pending rids — the finish gate’s question', () => {
  const first = aRecord({ rid: 'r-one', num: 1 })
  const second = aRecord({ rid: 'r-two', num: 2, title: 'Another record' })

  test('lists every record without a binding decision', () => {
    expect(pendingRids([first, second], 1, new Map())).toEqual(['r-one', 'r-two'])
  })

  test('counts hold as decided and an explicit pending as not', () => {
    const decisions = new Map([
      ['r-one', aDecision({ rid: 'r-one', state: 'hold', contentHash: hashRecordContent(first) })],
      [
        'r-two',
        aDecision({ rid: 'r-two', state: 'pending', contentHash: hashRecordContent(second) }),
      ],
    ])

    expect(pendingRids([first, second], 1, decisions)).toEqual(['r-two'])
  })

  test('a decision made against content that has since changed does not count', () => {
    const decisions = new Map([
      ['r-one', aDecision({ rid: 'r-one', state: 'approved', contentHash: 'stale' })],
    ])

    expect(pendingRids([first], 2, decisions)).toEqual(['r-one'])
  })
})
