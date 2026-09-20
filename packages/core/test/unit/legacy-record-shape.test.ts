import { describe, expect, test } from 'bun:test'
import type { Decision } from '#domain/models/decision.model'
import { changedSections, hashRecordContent } from '#domain/services/content-hash.service'
import { effectiveDecision } from '#domain/services/record-state.service'
import { aLegacyRecord } from '../support/fixtures'

/**
 * The upgrade: every record filed before solutions existed keeps working, and
 * keeps its decision.
 *
 * The whole of that promise reduces to one number. A decision binds to a
 * canonical-JSON hash of the record's narrative (D2), and a record whose hash no
 * longer matches goes back to `pending` — so if adding `solutions` to
 * `recordContent()` changed what a legacy record hashes to, every decided record
 * in production would have silently un-decided itself on
 * the first read after the upgrade.
 *
 * `LEGACY_CONTENT_HASH` was computed against the code as it stood **before**
 * the change, over the fixture copied verbatim from retro-1's export. It is a
 * constant here rather than a comparison against a rebuilt record on purpose:
 * a test that hashes twice with the same code passes however wrong that code
 * is, and this one has to fail if the bytes move.
 */
const LEGACY_CONTENT_HASH = '74e4bd9c2e828e054c9d858cf7cfc39a6c6b7bb1225984b8c717a7d69f893d9b'

describe('a record filed before solutions existed', () => {
  test('hashes to the byte-identical content hash it always did', () => {
    expect(hashRecordContent(aLegacyRecord())).toBe(LEGACY_CONTENT_HASH)
  })

  test('keeps the decision that was made against it', () => {
    const record = aLegacyRecord()
    // As a production store holds it: approved on revision 1, bound to the hash
    // above, and read back on a later revision by a binary that knows solutions.
    const decision: Decision = {
      id: 1,
      retroId: 1,
      rid: record.rid,
      version: 1,
      state: 'approved',
      severity: 5,
      solutionLevel: 1,
      selectedSolution: undefined,
      involvement: 'autonomous',
      reviewerNote: undefined,
      revisionN: 1,
      contentHash: LEGACY_CONTENT_HASH,
      decidedAt: '2026-08-23T20:54:00.000Z',
    }

    const effective = effectiveDecision(record, 2, decision)

    expect(effective.state).toBe('approved')
    expect(effective.contentChangedSince).toBeUndefined()
    expect(effective.carriedOver).toBe(true)
    expect(effective.solutionLevel).toBe(1)
  })

  /**
   * The same promise for the field added after it was filed: a legacy record has
   * no diagnostic data, and a binary that knows about diagnostic data reads it
   * back unchanged — the key is not on the blob, `canonicalJson` never sees it,
   * and the hash the decision is bound to is the constant above.
   *
   * The second half is the redraft: a record already decided gets re-filed,
   * this time with the evidence the new schema requires. That must not
   * move the hash, or every carried-over verdict in production would
   * go back to pending on the first draft written under the new contract.
   */
  test('carries no diagnostic data, and gains none without moving the hash', () => {
    expect(aLegacyRecord().diagnosticData).toBeUndefined()
    expect(hashRecordContent(aLegacyRecord({ diagnosticData: '- **A log line.**' }))).toBe(
      LEGACY_CONTENT_HASH,
    )
  })

  test('still reports its narrative sections as the sections they always were', () => {
    expect(
      changedSections(aLegacyRecord(), aLegacyRecord({ agreedDirection: 'Something else.' })),
    ).toEqual(['direction'])
    expect(changedSections(aLegacyRecord(), aLegacyRecord({ footprint: '- other.ts' }))).toEqual([
      'footprint',
    ])
  })
})
