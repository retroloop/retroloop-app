import { describe, expect, test } from 'bun:test'
import { laneFootprint, laneSolution } from '#application/views/lane.view'
import type { RetroRecord } from '#domain/models/record.model'
import { hashRecordContent } from '#domain/services/content-hash.service'
import { effectiveDecision } from '#domain/services/record-state.service'
import { aLegacyRecord, aRecord, someSolutions } from '../support/fixtures'

/**
 * The two derivations behind a lane row's `selectedSolution` — *"which fix, and
 * what does it touch"* in the shape an agent about to do the work needs it
 * (`lane.view.ts`).
 *
 * They are tested here rather than through the use case because both are pure
 * string work over a record that may be in either of the two shapes this product
 * reads (`record.model.ts`), and every interesting case is a *sentence* — a
 * bold lead that is there or is not, a footprint that is a tree or the literal
 * `none`. Driving those through a store would be five lines of fixture per
 * assertion and would prove nothing extra.
 */
const decisionOf = (record: RetroRecord, selected?: number) =>
  effectiveDecision(
    record,
    1,
    selected === undefined
      ? undefined
      : {
          id: 1,
          retroId: 1,
          rid: record.rid,
          version: 1,
          state: 'approved',
          severity: 3,
          solutionLevel: 1,
          selectedSolution: selected,
          involvement: 'pull-request',
          reviewerNote: undefined,
          revisionN: 1,
          // The real hash, so the verdict binds the way a stored one does — a
          // mismatched one would read as `pending` through carry-over and the
          // selection would never be reached.
          contentHash: hashRecordContent(record),
          decidedAt: '2026-09-13T10:00:00.000Z',
        },
  )

describe('the solution a lane row shows', () => {
  test('is the one the human picked, with its level, its lead and its files', () => {
    const record = aRecord()

    expect(laneSolution(record, decisionOf(record, 1))).toEqual({
      index: 1,
      level: 1,
      title: 'Document the lock.',
      body: '- **Document the lock.** Say in the runbook which process owns it.',
      footprint: ['docs/runbook.md'],
    })
  })

  /**
   * Nobody has decided, so the row shows what the AI recommends — the same rule
   * the three dials follow, and the reason this reads `decision.selectedSolution`
   * rather than the array's first element.
   */
  test('falls back to the recommended solution while the record is undecided', () => {
    const record = aRecord()

    expect(laneSolution(record, decisionOf(record))).toEqual({
      index: 2,
      level: 2,
      title: 'Write the holder PID.',
      body: '- **Write the holder PID.** Check liveness before waiting on the lock.',
      footprint: ['scripts/deploy.sh', 'lib/lock.ts'],
    })
  })

  /**
   * A record filed before solutions existed has one direction and one footprint
   * for the whole record, and the lane shows that rather than an empty block:
   * production stores are full of them, and a queue that skipped them would
   * skip every early retrospective.
   */
  test('reads a legacy record’s direction as solution 1', () => {
    const record = aLegacyRecord({
      agreedDirection: 'Write the holder PID.\nCheck liveness before waiting.',
      footprint: '- scripts/deploy.sh\n- lib/lock.ts',
      defaults: { severity: 3, involvement: 'pull-request', solutionLevel: 3 },
    })

    expect(laneSolution(record, decisionOf(record))).toEqual({
      index: 1,
      level: 3,
      title: 'Write the holder PID.',
      body: 'Write the holder PID.\nCheck liveness before waiting.',
      footprint: ['scripts/deploy.sh', 'lib/lock.ts'],
    })
  })

  /** No bold lead: the first line stands in, with its bullet marker taken off. */
  test('uses the first line when the bullets carry no bold lead', () => {
    const record = aRecord({
      solutions: someSolutions([
        { bullets: '- Say in the runbook which process owns the lock.', recommended: true },
        { recommended: false },
      ]),
    })

    expect(laneSolution(record, decisionOf(record)).title).toBe(
      'Say in the runbook which process owns the lock.',
    )
  })

  test('skips a leading blank line rather than reading one as the title', () => {
    const record = aRecord({
      solutions: someSolutions([
        { bullets: '\n\n* Delete the lock by hand.\n* Then fix it properly.', recommended: true },
        { recommended: false },
      ]),
    })

    expect(laneSolution(record, decisionOf(record)).title).toBe('Delete the lock by hand.')
  })

  /**
   * A selection the array cannot answer for cannot come from the write path, and
   * a row that rendered `undefined` for it would be worse than a row that showed
   * the recommendation: the reader is about to go and do the work.
   */
  test('falls back to the recommendation when the stored pick names no solution', () => {
    const record = aRecord()

    expect(laneSolution(record, decisionOf(record, 9)).index).toBe(2)
  })
})

describe('the files a solution touches', () => {
  test('is one entry per line, trimmed and stripped of its bullet marker', () => {
    expect(laneFootprint('- scripts/deploy.sh\n*  lib/lock.ts  \n  docs/runbook.md')).toEqual([
      'scripts/deploy.sh',
      'lib/lock.ts',
      'docs/runbook.md',
    ])
  })

  test('drops blank lines rather than carrying empty entries', () => {
    expect(laneFootprint('- one.ts\n\n   \n- two.ts')).toEqual(['one.ts', 'two.ts'])
  })

  /**
   * `none` is the literal the schema allows in place of a tree, and it means
   * "this touches no files" — so it is an empty list rather than a list holding
   * the word, which a caller would otherwise have to know to filter out.
   */
  test('reads the literal none as no files at all', () => {
    expect(laneFootprint('none')).toEqual([])
    expect(laneFootprint('  none  ')).toEqual([])
    expect(laneFootprint('')).toEqual([])
  })

  /** A file that is genuinely called `none.ts` is not the literal. */
  test('does not mistake a path for the literal', () => {
    expect(laneFootprint('- none.ts')).toEqual(['none.ts'])
  })
})
