import { beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createApp,
  createMemoryStore,
  decisionStateSchema,
  FinishGateError,
  involvementSchema,
  parseRevisionInput,
  recordInputSchema,
  recordSectionSchema,
  severitySchema,
  solutionLevelInputSchema,
  type ValidationError,
} from '@retro/core'

import { threadJson } from '#views'
import { aRevisionDraft } from './support/harness'

const ROOT = join(import.meta.dir, '../../..')
const SKILL = join(ROOT, '.claude/skills/retroloop/SKILL.md')
const BIN = join(import.meta.dir, '../src/bin.ts')
/**
 * The renderer the subset is a contract with (`r-subset-renderer-drift`).
 *
 * Read as a file, not imported: `apps/cli` and `apps/web` are siblings and
 * neither may import the other (repo-layout.md). That is the same standing this
 * file already gives SKILL.md and the root package.json — the artifacts it
 * checks are artifacts, and it reads them.
 */
const PROSE = join(ROOT, 'apps/web/src/components/review/prose.tsx')

/**
 * The `/retro` skill against the binary it drives.
 *
 * A skill is instructions for a process that cannot ask questions: if it names a
 * command that does not exist, the AI following it gets exit 2 mid-retro and has
 * no way to tell a typo in the skill from a mistake of its own. So every command
 * the skill names is checked to exist, and every flag it passes is checked to be
 * a flag that command takes.
 *
 * The commands are read out of the fenced blocks — the parts an AI copies — and
 * checked against the CLI's own help, which is generated from the parser rather
 * than written down twice.
 */
type Invocation = {
  readonly group: string
  readonly action: string | undefined
  readonly flags: string[]
  readonly line: string
}

/** Flags that are global rather than any one command's. */
const GLOBAL_FLAGS = new Set(['--json', '--home', '--quiet', '--help', '--version'])

function parseInvocations(markdown: string): Invocation[] {
  const fences = [...markdown.matchAll(/```([\s\S]*?)```/g)].map((match) => match[1] ?? '')
  const invocations: Invocation[] = []

  for (const block of fences) {
    for (const raw of block.split('\n')) {
      const line = raw.trim()
      if (!line.startsWith('retroloop ')) continue

      const tokens = line.split(/\s+/).slice(1)
      const words = tokens.filter((token) => !token.startsWith('-'))
      const group = words[0]
      if (group === undefined) continue

      invocations.push({
        group,
        // `retroloop up` and `retroloop export` take no action word; the rest do.
        action: words[1]?.startsWith('<') === false ? words[1] : undefined,
        flags: tokens
          .filter((token) => token.startsWith('--'))
          .map((token) => token.split('=')[0] ?? token)
          .filter((flag) => !GLOBAL_FLAGS.has(flag)),
        line,
      })
    }
  }
  return invocations
}

/**
 * One marker as the document shows it. `shown` says how it is written there: as
 * a code span the marker opens, or — the fence alone — named in words, because a
 * triple backtick inside a code span is a fight with the markdown around it.
 */
type Documented = { readonly text: string; readonly shown: boolean }

/**
 * The renderer's marker enumeration, read out of its source.
 *
 * One entry per line, anchored: a greedy match with the enumeration written on
 * one line would swallow the whole object into a single bogus marker and the
 * check would pass on nonsense. Anchored, a reformat that broke this reads back
 * as no markers at all, which the emptiness guard in the test turns into a
 * failure rather than a silent success.
 */
function grammarMarkers(): { readonly name: string; readonly marker: string }[] {
  const source = readFileSync(PROSE, 'utf8')
  const enumeration = /export const PROSE_MARKERS = \{([\s\S]*?)\} as const/.exec(source)?.[1] ?? ''

  return [...enumeration.matchAll(/^\s*(\w+): '(.*)',$/gm)].map((match) => ({
    name: match[1] ?? '',
    marker: match[2] ?? '',
  }))
}

/**
 * The subset SKILL.md documents, taken from the one sentence that lists it.
 *
 * Scoped to that sentence rather than to the paragraph it sits in, which also
 * quotes a record id and a field name in backticks: a check that read every code
 * span in the paragraph would demand the renderer parse `footprint`. The two
 * anchors are the sentence's own opening and closing words, so a rewrite that
 * moved the list fails here rather than quietly checking nothing.
 */
function documentedSubset(markdown: string): Documented[] {
  const sentence =
    /write the literal characters:([\s\S]*?)never parsed\)\./.exec(markdown)?.[1] ?? ''
  // The double-backtick span first, because it is the one holding a backtick.
  const doubled = [...sentence.matchAll(/``(.+?)``/g)].map((match) => (match[1] ?? '').trim())
  const single = [...sentence.replace(/``.+?``/g, ' ').matchAll(/`([^`]+)`/g)].map(
    (match) => match[1] ?? '',
  )

  return [
    ...[...doubled, ...single].map((text) => ({ text, shown: true })),
    ...(sentence.includes('triple-backtick') ? [{ text: '```', shown: false }] : []),
  ]
}

async function helpFor(command: string): Promise<string> {
  const child = Bun.spawn(['bun', 'run', BIN, ...command.split(' '), '--help'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  await child.exited
  return `${stdout}${stderr}`
}

describe('the /retro skill', () => {
  let markdown = ''
  let invocations: Invocation[] = []
  let rootHelp = ''
  const groupHelp = new Map<string, string>()

  /**
   * **Every help page at once** (`r-cli-suite-load-fragile`).
   *
   * This hook reads the CLI's help by running the CLI, once per command group
   * plus the root — nine `bun run bin.ts … --help` subprocesses. Started one
   * after another, its cost is process startup **times nine, serialized**, and
   * that sum is what grows when the machine is busy: three builds running at
   * once turned a hook that fits inside bun's 5s default into one that missed
   * it in three runs out of eight, on an unmodified base. Started together, the
   * sum collapses to the slowest single spawn, which is a number load moves far
   * less. Measured under the same load, the parallel form saw 0 failures in 6
   * runs against 3 in 6.
   *
   * **Not a raised timeout.** The budget is untouched on purpose: what was wrong
   * was the serialized multiplication, and raising the ceiling would have kept
   * it and hidden it.
   *
   * The pages come back paired with the group that asked for them, rather than
   * as an array read back by index, so nothing here can quietly file one
   * command's help under another's name.
   */
  beforeAll(async () => {
    markdown = readFileSync(SKILL, 'utf8')
    invocations = parseInvocations(markdown)

    const groups = [...new Set(invocations.map((invocation) => invocation.group))]
    const pages = await Promise.all(
      ['', ...groups].map(async (group) => [group, await helpFor(group)] as const),
    )

    for (const [group, help] of pages) {
      if (group === '') rootHelp = help
      else groupHelp.set(group, help)
    }
  })

  test('names at least the commands the loop is built from', () => {
    const named = new Set(invocations.map((invocation) => invocation.group))

    // `request` was on this list until `r-remove-requests` took the whole ask
    // channel out; a skill that still named it would send an AI at a command
    // the CLI no longer has.
    //
    // `label` and `attribute` joined it later: they are the AI's transport for
    // the two vocabularies, and the one place in this whole surface where an
    // exit 5 is a real answer rather than a bug — which is why the skill had to
    // grow a passage about them and to correct its own "you cannot actually
    // reach 5".
    expect([...named].sort()).toEqual([
      'attribute',
      'comment',
      'export',
      'label',
      'note',
      'record',
      'review',
      'revision',
      'session',
      'up',
    ])
  })

  test('every command it names exists', () => {
    for (const invocation of invocations) {
      expect(rootHelp, `\`${invocation.line}\` names a command the CLI does not have`).toContain(
        `retroloop ${invocation.group}`,
      )
    }
  })

  test('every action it names is one that command offers', () => {
    for (const invocation of invocations) {
      if (invocation.action === undefined) continue
      const help = groupHelp.get(invocation.group) ?? ''
      expect(
        help,
        `\`${invocation.line}\`: ${invocation.group} has no ${invocation.action}`,
      ).toContain(invocation.action)
    }
  })

  test('every flag it passes is one that command takes', () => {
    for (const invocation of invocations) {
      const help = groupHelp.get(invocation.group) ?? ''
      for (const flag of invocation.flags) {
        expect(help, `\`${invocation.line}\`: ${invocation.group} has no ${flag}`).toContain(flag)
      }
    }
  })

  test('drives the whole content check, not just the record states', () => {
    // The branch every round now lands in (`r-one-finish-button`): the wait
    // returns one event and the *content* says what to do next, so a skill that
    // could only see which records are pending would have to guess. Every
    // command that reads the human's words back is required to be in here by
    // name, with the flag that makes it useful — and `review close`, because
    // without it the loop has no way to end.
    const calls = (group: string, action: string, flag?: string): Invocation[] =>
      invocations.filter(
        (invocation) =>
          invocation.group === group &&
          invocation.action === action &&
          (flag === undefined || invocation.flags.includes(flag)),
      )

    for (const [group, action, flag] of [
      ['note', 'list', '--with-human'],
      ['revision', 'get', '--feedback-only'],
      ['comment', 'list', '--unanswered'],
      ['comment', 'add', undefined],
      // Where a review-level ask gets answered (`r-cli-review-thread-reply`). A
      // skill that only showed `--record --section` would send the AI back to
      // chat for the threads that hang off no record.
      ['comment', 'add', '--thread'],
      ['comment', 'add', '--review'],
      ['record', 'list', '--state'],
      ['review', 'status', undefined],
      ['review', 'close', undefined],
    ] as const) {
      expect(
        calls(group, action, flag),
        `SKILL.md never calls \`retroloop ${group} ${action}${flag === undefined ? '' : ` ${flag}`}\``,
      ).not.toBeEmpty()
    }
  })

  test('says the thing about human notes that nothing enforces', () => {
    // Caller protocol: the core cannot tell a drafting read from any other read.
    // If the skill stops saying so, nothing else will.
    expect(markdown).toContain('drafting time only')
  })

  test('says that a revise verdict has to be addressed, not just noticed', () => {
    // The third verdict is an instruction (`r-verdict-revise`), and the one
    // place an AI reads instructions is this file. `review close` refuses over
    // one, so a skill that did not say so would send it into an exit 4 it
    // could not explain.
    expect(markdown).toContain('must-address')
  })

  test('says where an ask arrives, now that there is one channel for it', () => {
    // The other half of `r-remove-requests`: an AI that read the old skill
    // went looking for `request list` for the human's asks. There is one place
    // they land now and the skill has to name it, because nothing about an
    // empty `requests` array says where to look instead.
    expect(markdown).toContain('every ask now arrives as a comment')
  })

  /**
   * The three tests below are what "self-sufficient" means mechanically
   * (`r-skill-not-self-sufficient`).
   *
   * The skill ships to other repositories through the plugin, where none of the
   * source it used to lean on exists: a fresh reader holding only this file has
   * to be able to author a whole record without guessing. That makes the embedded
   * schema a copy, and a copy rots — so the vocabularies are checked against the
   * enums they were copied from, and the worked example is fed to the real
   * validator rather than eyeballed.
   */
  test('embeds every vocabulary a cold reader has to choose from', () => {
    // Word-shaped values are distinctive enough that naming them anywhere is
    // proof they are documented.
    for (const [what, schema] of Object.entries({
      involvement: involvementSchema,
      'record state': decisionStateSchema,
    })) {
      for (const value of schema.values) {
        expect(markdown, `SKILL.md never names the ${what} \`${String(value)}\``).toContain(
          `\`${String(value)}\``,
        )
      }
    }

    /**
     * The sections need the whole list, not each name somewhere — and a plant
     * proved that too. SKILL.md warns that `--section` takes `direction` and
     * **not** `agreed_direction`; naming the wrong value as a counterexample
     * satisfies a presence check for it forever, so renaming the real section to
     * `agreed_direction` slipped past while the doc taught the opposite.
     *
     * Comparing the joined list catches a rename, a reorder, an addition and a
     * removal alike. Whitespace is collapsed because the sentence wraps.
     */
    const sections = [...recordSectionSchema.values].map((one) => `\`${one}\``).join(', ')
    expect(
      markdown.replace(/\s+/g, ' '),
      `SKILL.md does not list the sections as: ${sections}`,
    ).toContain(sections)

    /**
     * The numeric ones need more than presence, and a plant proved it: SKILL.md
     * claims severity's five values are "the whole value space", but a sixth
     * value slipped past a `toContain('`6`')` check because `6` also appears in
     * the exit-code list. A digit is not distinctive prose.
     *
     * So they are checked against their **table row**, which is where the doc
     * actually documents them. A widened enum then fails for the right reason:
     * the new value has no row.
     */
    for (const [what, schema] of Object.entries({
      severity: severitySchema,
      'solution level': solutionLevelInputSchema,
    })) {
      for (const value of schema.values) {
        expect(
          markdown,
          `SKILL.md has no table row explaining ${what} \`${String(value)}\``,
        ).toContain(`| \`${String(value)}\` |`)
      }
    }
  })

  /**
   * The rebuild path in §4 tells the reader a record's `content` is "the same
   * thirteen keys as the table in step 3" — a spelled-out count, which is a fact
   * that rots the moment a field is added and which a reader will use to check
   * their own work. It was caught wrong once; this is why it cannot go wrong
   * quietly again.
   */
  test('counts the record’s fields the way the schema does', () => {
    const fields = Object.keys(recordInputSchema.shape)
    const spelled = [
      'zero',
      'one',
      'two',
      'three',
      'four',
      'five',
      'six',
      'seven',
      'eight',
      'nine',
      'ten',
      'eleven',
      'twelve',
      'thirteen',
      'fourteen',
      'fifteen',
    ][fields.length]

    expect(markdown, `the record has ${fields.length} fields; SKILL.md never says so`).toContain(
      `the same ${spelled} keys`,
    )
    // And the table itself names every one of them.
    for (const field of fields) {
      expect(markdown, `SKILL.md never names the record field \`${field}\``).toContain(
        `| \`${field}\` |`,
      )
    }
  })

  /** The fenced block a given command's example lives in. */
  function fenceContaining(command: string): string {
    const blocks = [...markdown.matchAll(/```([\s\S]*?)```/g)]
      .map((match) => match[1] ?? '')
      .filter((block) => block.includes(command))

    expect(blocks, `no fenced block shows \`${command}\``).not.toHaveLength(0)
    return blocks.join('\n')
  }

  /** The one fenced JSON block that is a whole revision — see the test below. */
  function workedExample(): string {
    const examples = [...markdown.matchAll(/```json\n([\s\S]*?)```/g)]
      .map((match) => match[1] ?? '')
      .filter((block) => block.includes('"rid"'))

    // One, so that "the example" is unambiguous to a reader copying it.
    expect(examples).toHaveLength(1)
    return examples[0] as string
  }

  test('its worked example is a revision the schema accepts', () => {
    expect(() => parseRevisionInput(JSON.parse(workedExample()))).not.toThrow()
  })

  /**
   * The refusal a cold agent is most likely to hit and least able to interpret:
   * the human undid a verdict after finishing, `review close` refuses, and no
   * re-reading of the round changes it. SKILL.md quotes the error document so
   * the reader recognises it on sight — which makes the quote a copy of a
   * string the core owns, checked here against the source.
   */
  test('quotes the finish-gate refusal exactly as the CLI prints it', () => {
    const refusal = new FinishGateError(34, ['r-slow-tests'])

    expect(markdown).toContain(refusal.message)
    expect(markdown).toContain('"code":"FINISH_GATE"')
  })

  /**
   * The four refusals a draft's `solutions` can earn, quoted in SKILL.md so a
   * cold reader can tell which rule they broke rather than being told only that
   * "the `message` says which".
   *
   * A quote is a copy of a string the core owns, so it is checked against the
   * source the same way the finish-gate refusal is — by provoking the real
   * failure and asserting the document carries what it actually printed.
   */
  test('quotes each solutions refusal exactly as the CLI prints it', () => {
    // Provoked against the document's **own** worked example, so the refusals
    // are the ones a reader following this file would actually see.
    const example = JSON.parse(workedExample()) as { records: [Record<string, unknown>] }
    const record = (solutions: unknown) => ({
      records: [{ ...example.records[0], solutions }],
    })
    const at = (level: number, recommended = false) => ({
      bullets: 'a',
      footprint: 'b',
      level,
      recommended,
    })

    // Each case breaks exactly one rule, so the message it earns names that
    // rule and not another one that happened to fire first.
    const refusals = [
      record([]),
      record([at(1), at(2, true), at(3), at(4)]),
      record([at(1), at(2)]),
      record([at(4, true), at(2)]),
    ].map((input) => {
      try {
        parseRevisionInput(input)
      } catch (error) {
        return (error as ValidationError).issues[0]?.message ?? ''
      }
      throw new Error('a draft that breaks a solutions rule was accepted')
    })

    // Four distinct messages, so a quote cannot satisfy two rules at once.
    expect(new Set(refusals).size).toBe(4)
    for (const message of refusals) {
      expect(markdown, `SKILL.md does not quote the refusal: ${message}`).toContain(message)
    }
  })

  /**
   * The thread shape SKILL.md prints, against the projection the CLI actually
   * writes (`views.ts` §threadJson).
   *
   * The document is the only shape a drafting AI has: it never sees the source,
   * so a key the CLI emits and the document omits is a field nobody knows to
   * read — which is how `resolved` and `revision` came to be missing from it
   * when resolvable comments shipped. Scoped to the `comment list` block, so
   * the key names cannot be satisfied by a mention somewhere else in the file.
   */
  test('prints the thread shape the CLI actually writes', () => {
    const block = fenceContaining('retroloop comment list')
    const shape = threadJson({
      id: 7,
      retroId: 34,
      rid: 'r-stale-lock',
      section: 'problem',
      openedAt: '2026-08-24T09:00:00.000Z',
      resolved: false,
      messages: [
        {
          id: 9,
          threadId: 7,
          actor: 'human',
          text: 'The impact is understated.',
          at: '2026-08-24T09:00:00.000Z',
          revisionN: 1,
          revision: 1,
        },
      ],
    })
    const keys = [...Object.keys(shape), ...Object.keys(shape.messages[0] ?? {})]

    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) {
      expect(block, `the comment list example does not show \`${key}\``).toContain(`"${key}"`)
    }
  })

  /**
   * The claim the document makes about `--unanswered`, proved rather than
   * asserted: it reads who wrote last and **nothing else**, so a thread the
   * human settled after his own final message is still listed by it.
   *
   * That sentence is what stops a drafting AI treating every listed thread as an
   * open ask and answering one he has already closed. If the filter ever learns
   * about `resolved`, the document becomes wrong and this fails.
   */
  test('the unanswered filter ignores resolved, exactly as the skill says', async () => {
    const store = createMemoryStore()
    const app = createApp(store, { clock: { now: () => new Date('2026-08-24T09:00:00.000Z') } })

    const { session } = await app.sessions.create.execute({
      actor: 'ai',
      claudeSession: 'uuid-skill',
      cwd: '/tmp/retro',
    })
    const { retroId } = await app.revisions.create.execute({
      actor: 'ai',
      session: session.id,
      revision: JSON.parse(aRevisionDraft([{ rid: 'r-stale-lock', num: 1 }])),
    })
    const { thread } = await app.threads.addComment.execute({
      actor: 'human',
      retro: { retroId },
      target: { kind: 'record', rid: 'r-stale-lock', section: 'problem' },
      text: 'The impact is understated.',
    })
    await app.threads.resolve.execute({
      actor: 'human',
      threadId: thread.id,
      resolved: true,
    })

    const listed = await app.threads.list.execute({
      actor: 'ai',
      retro: { retroId },
      unansweredOnly: true,
    })

    expect(listed.threads.map((one) => one.id)).toEqual([thread.id])
    expect(listed.threads[0]?.resolved).toBe(true)
    // Whitespace-collapsed, because the sentence wraps in the document.
    expect(markdown.replace(/\s+/g, ' ')).toContain('it does not look at `resolved` at all')
  })

  /**
   * The documented subset against the grammar that implements it — the one
   * check neither side had (`r-subset-renderer-drift`).
   *
   * A wrong marker planted in the documented subset as a routine
   * plant-and-catch failed to fail: seventeen skill tests assert SKILL.md's
   * structure and wording, every web test asserts `prose.tsx`'s behaviour, and
   * no test read both artifacts. So "the review page renders exactly that
   * subset" could silently lie, and a record authored to a documented marker
   * the renderer rejects would render as literal text with no red anywhere —
   * exported to every repository the skill ships to.
   *
   * Two directions, because either alone leaves half the drift uncovered: a
   * marker the renderer reads and the skill never documents is a construct
   * authors are not told about, and a marker the skill documents that the
   * renderer does not read is the plant that started this.
   */
  test('documents exactly the markdown subset the renderer parses', () => {
    const grammar = grammarMarkers()
    const documented = documentedSubset(markdown)

    // Neither list may be empty, or both loops below pass by having nothing to
    // say — which is precisely how a check that reads two files stops checking.
    expect(grammar, 'prose.tsx exports no marker enumeration to check against').not.toBeEmpty()
    expect(documented, "SKILL.md's subset sentence lists no markers").not.toBeEmpty()

    /**
     * A documented entry answers for a marker when it is the marker: shown ones
     * are samples the marker opens (`**bold**` for `**`), and the fence is
     * named in words rather than shown, so it is matched whole.
     */
    const answersFor = (entry: Documented, marker: string): boolean =>
      entry.shown ? entry.text.startsWith(marker) : entry.text === marker

    for (const { name, marker } of grammar) {
      expect(
        documented.some((entry) => answersFor(entry, marker)),
        `prose.tsx reads the ${name} marker \`${marker}\` and SKILL.md's subset never documents it`,
      ).toBe(true)
    }

    for (const entry of documented) {
      expect(
        grammar.some(({ marker }) => answersFor(entry, marker)),
        `SKILL.md's subset documents \`${entry.text}\` and prose.tsx's grammar reads no such marker`,
      ).toBe(true)
    }
  })

  test('names an in-repo invocation that exists', () => {
    // `retro` resolves nowhere in a fresh checkout (`r-retro-bin-not-on-path`),
    // so the skill names a fallback — and a fallback is only worth naming while
    // the script behind it is still there.
    const rootPackage = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }

    expect(rootPackage.scripts.retroloop).toBeDefined()
    expect(markdown).toContain('bun run --silent retroloop')
  })

  test('tells the AI what it may never do', () => {
    // The actor invariants are mechanical in core, but a skill that does not say
    // them invites the AI to try, get exit 5, and improvise.
    expect(markdown).toContain('Never decide a record')
    expect(markdown).toContain('Never infer approval from silence')
    expect(markdown).toContain('Never edit a revision')
  })
})
