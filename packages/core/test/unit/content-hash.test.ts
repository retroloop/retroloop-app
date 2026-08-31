import { describe, expect, test } from 'bun:test'
import {
  canonicalJson,
  changedSections,
  hashRecordContent,
} from '#domain/services/content-hash.service'
import { aLegacyRecord, aRecord, someSolutions } from '../support/fixtures'

describe('canonical JSON', () => {
  test('is stable under key order — the same content always hashes the same', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }))
  })

  test('treats an absent member and an undefined one as the same thing', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }))
  })

  test('keeps array order, which is content', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]))
  })
})

describe('record content hash', () => {
  test('is identical for two structurally identical records', () => {
    expect(hashRecordContent(aRecord())).toBe(hashRecordContent(aRecord()))
  })

  test('changes when any narrative field changes', () => {
    const before = hashRecordContent(aRecord())

    expect(hashRecordContent(aRecord({ title: 'A different title' }))).not.toBe(before)
    expect(hashRecordContent(aRecord({ workaround: 'none' }))).not.toBe(before)
    expect(
      hashRecordContent(
        aRecord({
          rootCause: { whatHappened: 'x', whys: ['different'], root: 'y' },
        }),
      ),
    ).not.toBe(before)
  })

  test('ignores the AI’s proposed defaults — a decision binds to the narrative (D2)', () => {
    expect(
      hashRecordContent(
        aRecord({
          defaults: { severity: 5, involvement: 'autonomous' },
        }),
      ),
    ).toBe(hashRecordContent(aRecord()))
  })

  /**
   * The one place solutions differ from the AI's other proposals, and the reason
   * they had to: the human's answer to a solutions record is an *index into this
   * array*. "Approved a level 2" survives the AI re-proposing a 4; "picked
   * solution 2" means nothing once solution 2 is a different proposal.
   */
  describe('the solutions the AI proposes, which the human picks from', () => {
    test('changes the hash when a solution’s text changes', () => {
      expect(
        hashRecordContent(
          aRecord({ solutions: someSolutions([{}, { bullets: '- **A different plan.**' }]) }),
        ),
      ).not.toBe(hashRecordContent(aRecord()))
    })

    test('changes the hash when a level, a footprint or the recommendation moves', () => {
      const before = hashRecordContent(aRecord())

      expect(hashRecordContent(aRecord({ solutions: someSolutions([{ level: 3 }]) }))).not.toBe(
        before,
      )
      expect(
        hashRecordContent(aRecord({ solutions: someSolutions([{ footprint: 'elsewhere.md' }]) })),
      ).not.toBe(before)
      expect(
        hashRecordContent(
          aRecord({ solutions: someSolutions([{ recommended: true }, { recommended: false }]) }),
        ),
      ).not.toBe(before)
    })

    test('changes the hash when a solution is added or dropped', () => {
      const solutions = someSolutions()
      expect(hashRecordContent(aRecord({ solutions: solutions.slice(0, 1) }))).not.toBe(
        hashRecordContent(aRecord()),
      )
    })
  })
})

describe('changed sections', () => {
  test('is empty for an unchanged record', () => {
    expect(changedSections(aRecord(), aRecord())).toEqual([])
  })

  test('names only the sections that actually differ', () => {
    expect(
      changedSections(
        aRecord(),
        aRecord({ solutions: someSolutions([{ bullets: '- **Something else.** Entirely.' }]) }),
      ),
    ).toEqual(['solutions'])
    expect(changedSections(aRecord(), aRecord({ workaround: 'none' }))).toEqual(['workaround'])
  })

  /**
   * The legacy anchors still answer for the records that have them — that is
   * what keeps a comment filed on retro 1's "Agreed direction" pointing at
   * something.
   */
  test('names the legacy sections on a record that has them', () => {
    expect(
      changedSections(aLegacyRecord(), aLegacyRecord({ agreedDirection: 'Something else.' })),
    ).toEqual(['direction'])
    expect(changedSections(aLegacyRecord(), aLegacyRecord({ footprint: '- other.ts' }))).toEqual([
      'footprint',
    ])
  })

  test('a record redrafted from the old shape into the new one changes all three', () => {
    expect(changedSections(aLegacyRecord(), aRecord({ rid: 'x', num: 1 }))).toContain('direction')
    expect(changedSections(aLegacyRecord(), aRecord({ rid: 'x', num: 1 }))).toContain('footprint')
    expect(changedSections(aLegacyRecord(), aRecord({ rid: 'x', num: 1 }))).toContain('solutions')
  })

  test('reports the fields the section enum has no slot for', () => {
    // `type` rides with the headline, `requester`/`impacts` with the problem —
    // otherwise they could change with no section lighting up.
    expect(changedSections(aRecord(), aRecord({ type: 'feature' }))).toEqual(['title'])
    expect(changedSections(aRecord(), aRecord({ impacts: 'ai' }))).toEqual(['problem'])
  })

  test('reports a change to the proposed defaults', () => {
    expect(
      changedSections(
        aRecord(),
        aRecord({ defaults: { severity: 1, involvement: 'pull-request' } }),
      ),
    ).toEqual(['defaults'])
  })
})
