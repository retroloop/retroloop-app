import type { RecordInput, RevisionInput } from '#application/schemas/revision-input.schema'
import type { LegacyRecord, Solution, SolutionsRecord } from '#domain/models/record.model'

/**
 * Fixture builders. They produce the *smallest input a real revision could carry*
 * — every mechanical rule of D5 satisfied and nothing more — so a test that
 * overrides one field is unambiguously testing that field.
 */
export function aRecordInput(overrides: Partial<RecordInput> = {}): RecordInput {
  return {
    rid: 'r-deploy-blocked',
    num: 1,
    title: 'Deploy blocked on a stale lock file',
    type: 'issue',
    problem: 'The deploy waited 40 minutes on a lock nothing held.',
    humanWords: [
      {
        verbatim: 'this thing has been sitting there for ages',
        cleaned: 'This has been sitting there for a long time.',
        context: 'while watching the deploy log',
      },
    ],
    rootCause: {
      whatHappened: 'The lock file outlived the process that took it.',
      whys: ['The process was killed', 'The lock had no owner check'],
      root: 'Locks are advisory with no liveness check.',
    },
    workaround: 'Delete the lock file by hand.',
    /**
     * Two solutions, sorted, the second recommended — the smallest set that is
     * not degenerate. A one-solution fixture would make "the recommended one" and
     * "the first one" the same position, so every test of the selection fallback
     * would pass whichever of the two the code actually did.
     */
    solutions: [
      {
        bullets: '- **Document the lock.** Say in the runbook which process owns it.',
        footprint: 'docs/runbook.md',
        level: 1,
        recommended: false,
      },
      {
        bullets: '- **Write the holder PID.** Check liveness before waiting on the lock.',
        footprint: '- scripts/deploy.sh\n- lib/lock.ts',
        level: 2,
        recommended: true,
      },
    ],
    requester: 'human',
    impacts: 'human',
    defaults: { severity: 3, involvement: 'pull-request' },
    ...overrides,
  }
}

export function aRevisionInput(records: readonly Partial<RecordInput>[] = [{}]): RevisionInput {
  return {
    records: records.map((overrides, index) =>
      aRecordInput({ num: index + 1, rid: `r-record-${index + 1}`, ...overrides }),
    ),
  }
}

/**
 * A stored record, for the pure domain services that take one directly.
 *
 * Structurally identical to what `CreateRevisionUseCase` stores, so a fixture
 * and a record that actually went through the write path are the same thing.
 */
export function aRecord(overrides: Partial<SolutionsRecord> = {}): SolutionsRecord {
  const input = aRecordInput()
  return {
    ...input,
    humanWords: input.humanWords.map((words) => ({
      verbatim: words.verbatim,
      cleaned: words.cleaned,
      context: words.context,
    })),
    ...overrides,
  }
}

/**
 * The solutions of `aRecord()`, for a test that wants to change exactly one.
 *
 * Mutable, because it feeds `RecordInput.solutions` as often as it feeds a
 * stored record's, and the input type is what zod infers from `z.array`.
 */
export function someSolutions(overrides: readonly Partial<Solution>[] = []): Solution[] {
  return aRecordInput().solutions.map((solution, index) => ({
    ...solution,
    ...overrides[index],
  }))
}

/**
 * A record in the shape every revision before the solutions change was written
 * in — `agreedDirection` + `footprint`, no `solutions`.
 *
 * It is **not** a builder over `aRecordInput`: nothing may author this shape any
 * more (the write path takes solutions only), so the only way one exists is as a
 * JSON blob an earlier binary wrote. This is that blob, and its fields are
 * copied verbatim from record 11 of the owner's retro-1 export
 * (`~/.retroloop/retros/_legacy-exports/retro-1.json`, `r-falsifiability-paid`) so the
 * upgrade is tested against a document that actually exists rather than against
 * a shape a test invented.
 *
 * `defaults` is not in the export — the export carries the human's decided
 * values, not the AI's proposals — so those three are the decided ones, which is
 * what the AI would have proposed for a record approved without changing them.
 * Nothing in the content hash reads them.
 */
export function aLegacyRecord(overrides: Partial<LegacyRecord> = {}): LegacyRecord {
  return {
    rid: 'r-falsifiability-paid',
    num: 11,
    title: 'Plant-and-catch found two real bugs that every written test had passed',
    type: 'feature',
    problem:
      "**Filed as a practice that paid, not a friction.** The falsifiability discipline — every worker plants defects and must watch its own suites catch them before reporting — found two real bugs in finished, fully-green work: item 5's frozen tailer cursor (masked by the idle short-circuit until a restart re-emitted history) and item 7's unreachable duplicate `serve()` (found because a planted defect FAILED to fail, proving the code path dead). Both had passed every test written for them. The practice was ad-hoc: it lived in spawn specs, not in any doc.",
    humanWords: [],
    rootCause: {
      whatHappened:
        'Two defects invisible to example-based testing were surfaced by deliberately breaking the system and demanding the suites notice.',
      whys: [
        'Why did written tests miss them? Both bugs lived in paths the tests never exercised — one masked by an optimization, one dead code.',
        'Why did plants find them? A plant tests the TESTS: it asks whether the net can catch, not whether the fish already in it are dead.',
      ],
      root: 'Example suites verify anticipated behavior; only falsification probes verify the verification itself — and that step existed only as per-spawn instruction.',
    },
    workaround: 'none',
    agreedDirection:
      '(AI-suggested) Promote plant-and-catch from spawn-spec habit to standing rule: a short paragraph in testing.md §Operational rules (every worker report includes planted defects and what caught them; a check never observed failing is an unverified claim). Your approval makes it law.',
    footprint:
      'docs/design/testing.md (§Operational rules) · docs/EXECUTION.md (worker table note)',
    requester: 'ai',
    impacts: 'human',
    defaults: { severity: 5, solutionLevel: 1, involvement: 'autonomous' },
    ...overrides,
  }
}
