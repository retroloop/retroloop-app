import type { AppRouterOutputs } from '@retro/api'
import { useQuery } from '@tanstack/react-query'
import { MessageSquarePlusIcon } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { ActorTag } from '@/components/actor-tag'
import { RecordLabelTags } from '@/components/records/record-labels'
import { DecisionControls } from '@/components/review/decision-controls'
import { DecisionStateTag } from '@/components/review/decision-state'
import { Prose } from '@/components/review/prose'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { optionFor, type RecordSection, SECTION_TITLES, SOLUTION_LEVELS } from '@/lib/enum-labels'
import { useTRPC } from '@/lib/trpc'

type RecordSummary = AppRouterOutputs['records']['list']['records'][number]
type RecordDetail = AppRouterOutputs['records']['get']

/**
 * Who asked for this record — `ActorTag`, which is where the two words and the
 * two marks live now that a second surface names an actor (`actor-tag.tsx`).
 *
 * **Header only**, on this page. The rail is a place to *find* a record and the
 * dashboard counts them; neither is a place to argue with one, and a tag
 * repeated everywhere is a tag nobody reads (KC-0016).
 */

/**
 * One record, whole. The identity and verdict come from the list the page
 * already has, so the card has a heading before its own query answers; the
 * narrative, the values and the note come from `records.get`.
 *
 * Its comments do not, and no longer render here at all. They are in the panel
 * beside the page with every other comment on the retrospective, and what a
 * section keeps is the way to start one (`SectionComment`, `review-thread.tsx`).
 *
 * Nothing *inside* a record collapses or filters. A record is read in full or
 * it is not read, and a control that hides part of one would be a control that
 * can hide the part that mattered (KC-0016) — so every section is on screen
 * whenever the card is.
 *
 * The solutions strip is the one place that shows one thing at a time, and it is
 * the owner's own design rather than an exception someone took: *"3 different
 * solutions each in a tab within the retro card"*. It hides no part of the
 * record — the alternatives are alternatives, only one of them is going to be
 * built, and the strip itself names every one of them with its level, which one
 * the AI is behind and which one he picked. What a reader would lose by
 * collapsing a section is the section; what they lose here is a road not taken,
 * one click away and announced.
 *
 * Which records are on screen is a different question, and its answer changed:
 * the page filters whole records by decision state, because filtering to
 * pending and watching each decided record fall out is the owner's review
 * workflow (KC-0021, G5). That filter lives on the page, not in here — a card
 * has no say in whether it is one of the ones being read.
 */
export function RecordCard({
  retroId,
  revision,
  summary,
  readOnly,
  onComment,
}: {
  retroId: number
  revision: number
  summary: RecordSummary
  readOnly: boolean
  /**
   * The section's Comment button, pressed. The card raises it rather than
   * opening anything: the comment is written in the panel now, which is
   * somewhere else entirely on the page (`review-thread.tsx`).
   */
  onComment: (rid: string, section: RecordSection) => void
}) {
  const trpc = useTRPC()
  const detail = useQuery(trpc.records.get.queryOptions({ retroId, rid: summary.rid, revision }))

  return (
    <article
      className="flex flex-col gap-5 rounded-xl border border-hairline bg-card px-5 py-5"
      data-testid={`record-${summary.rid}`}
    >
      <header className="flex flex-col gap-2" data-testid="record-header">
        <div className="flex flex-wrap items-center gap-2">
          <span className="meta-mono" data-testid="record-num">
            #{summary.globalId}
          </span>
          <Badge variant="outline" data-testid="record-type">
            {summary.type}
          </Badge>
          {/* One tag for the verdict, and no second one beside it. A HELD tag
              rode here for one session and the owner removed the feature that
              fed it (retro 4 `r-remove-hold`): what an item needs from him is
              `involvement`, which is inside the decision rather than beside
              it. */}
          <DecisionStateTag state={summary.state} />
          {detail.data === undefined ? null : (
            // With the sections rather than with the heading: `requester` rides
            // on the narrative, so it arrives when the narrative does.
            <ActorTag party={detail.data.record.requester} testId="record-requester" />
          )}
          {/**
           * What the record wears, if anything — read-only here, because a
           * verdict is what this page is for and labelling is what the record's
           * own page is for (`records_.$recordId.tsx`). It renders nothing on a
           * record nobody has labelled, which is most of them, so no card grows
           * a row of whitespace for a mark it does not have.
           */}
          {detail.data === undefined ? null : <RecordLabelTags labels={detail.data.labels} />}
          {summary.carriedOver && summary.decidedOnRevision !== null ? (
            /**
             * D2 carry-over: this verdict was given for an earlier revision and
             * still binds because the content did not change. The reviewer is
             * being asked to trust a decision they are not making now, so the
             * page says which revision they are trusting.
             */
            <span className="meta-mono" data-testid="carried-over">
              decided on rev {summary.decidedOnRevision}
            </span>
          ) : null}
        </div>
        {/**
         * The title, and the thread it has always had
         * (`r-title-comments-unreachable`, the owner: *"I want abillity to post
         * a comment at the title level as well for a record"*).
         *
         * `title` is a first-class comment section in the model, in the CLI
         * (`comment add --record <rid> --section title`) and in the skill's own
         * section table; the header was styled as identity rather than as a
         * section, so it was the one section the page offered no way in to and
         * the human's only path there was asking the AI to file the comment for
         * him.
         *
         * **The glyph is inline, immediately after the title's last word**, and
         * that is his reviewer note verbatim: *"it should be right next to the
         * last word of the title. it shouldn't be separate on the right etc."*
         * So the `<h2>` is `inline` and the glyph follows it in the same
         * inline run — it sits after the last word wherever the title happens to
         * wrap, rather than at a column edge the title never reaches. Anything
         * `ml-auto`, any second flex column, any `justify-between` is the shape
         * he ruled out.
         */}
        <div className="leading-snug">
          <h2
            className="inline font-semibold text-lg leading-snug tracking-tight"
            data-testid="record-title"
          >
            {summary.title}
          </h2>
          <SectionComment
            rid={summary.rid}
            section="title"
            readOnly={readOnly}
            onComment={onComment}
          />
        </div>
      </header>

      {detail.data === undefined ? null : (
        <RecordBody
          /**
           * A verdict lands and the values it wrote are the new starting point;
           * remounting is how the fields stop showing what was chosen before it.
           *
           * It sits here rather than on `DecisionControls` because the decision
           * now seeds two things that are rendered in two different sections —
           * the three dials, and which solution the reviewer has picked — and a
           * key on one of them would leave the other showing the round before.
           */
          key={`${summary.rid}:${detail.data.revision}:${detail.data.decision.state}:${detail.data.decision.decidedOnRevision}:${detail.data.decision.reviewerNote}`}
          retroId={retroId}
          detail={detail.data}
          readOnly={readOnly}
          onComment={onComment}
        />
      )}
    </article>
  )
}

function RecordBody({
  retroId,
  detail,
  readOnly,
  onComment,
}: {
  retroId: number
  detail: RecordDetail
  readOnly: boolean
  onComment: (rid: string, section: RecordSection) => void
}) {
  const { record, decision } = detail

  /**
   * Which solution the record is going to be decided on.
   *
   * It is the dials' shape, one level up. `DecisionControls` holds severity,
   * involvement and the note as local state until a verdict button commits them;
   * this is the fourth value of the same verdict, and it lives here because the
   * control that sets it is in the solutions section and the button that sends
   * it is in the decision section.
   *
   * **A pending record with a strip arrives on the AI's recommendation, ticked.**
   * The owner ruled it (`r-recommended-preselected`): *"by default the
   * recommended solution should already be pre-selected when there are more than
   * one solutions."* Agreeing with the AI is the common case and it now costs no
   * press at all; the verdict carries the recommendation unchanged, and the `*`
   * appears only if he moves the tick somewhere else.
   *
   * This is a seeded default and not an inference from silence: what the AI
   * recommended is written into the record, so the value comes from the record
   * rather than from the reviewer's not having spoken. The tick says which
   * solution the verdict will carry — the same reading the three dials have,
   * where a pending record shows the AI's proposed severity with nothing having
   * been pressed either.
   *
   * A record with one solution seeds nothing. There is no strip on it, nothing to
   * tick, and no choice being offered, so the payload stays silent and the
   * server's fallback records the only solution there is
   * (`r-single-solution-no-tabs`).
   */
  const [picked, setPicked] = useState<number | null>(() => {
    if (decision.state !== 'pending') return decision.selectedSolution
    if (record.solutions === null || record.solutions.length < 2) return null
    return recommendedPosition(record.solutions)
  })
  /**
   * The section's own entry point into the panel. It is a click on a section and
   * nothing more: no composer opens here, no thread is rendered here, and what
   * the click does is aim the panel's one composer at this section (the owner:
   * *"Replace inline comments in retro body with comments in the side panel"*).
   */
  const commentOn = (section: RecordSection) => (
    <SectionComment section={section} readOnly={readOnly} onComment={onComment} rid={record.rid} />
  )

  return (
    <>
      {/* The record itself, rendered by the component the record page renders it
          with — so what a reader sees of a record does not depend on which of
          the two surfaces they are standing on. */}
      <RecordNarrative
        record={record}
        picked={picked}
        readOnly={readOnly}
        onPick={setPicked}
        comment={commentOn}
      />
      <Section section="defaults" comment={commentOn('defaults')}>
        <DecisionControls
          retroId={retroId}
          rid={record.rid}
          revision={detail.revision}
          decision={decision}
          readOnly={readOnly}
          // The ceiling is a property of the solution the human picks, so the
          // level control belongs with the solutions rather than in the decision
          // block. On a record that proposes none it is still a dial of its own.
          hasSolutions={record.solutions !== null}
          // Null on a record that proposes none, because there is nothing there
          // to select — the server refuses a selection on one, and this is the
          // only thing that can send it.
          selectedSolution={picked}
        />
      </Section>
    </>
  )
}

/**
 * A record's narrative, whole — the sections the AI authored, in the order it
 * authored them.
 *
 * **It is a component of its own since session 9**, and the reason is that a
 * record is now read in two places: on a card inside a review, and on its own
 * page (`/records/:id`, the owner's *"each record should have it's own
 * dedicated page"*). What a reader sees of the record itself has to be the same
 * on both — down to the way a footprint is drawn and the way human words are
 * left alone — and a second rendering of five sections is a second place for one
 * of them to quietly start reading differently.
 *
 * What stays outside it is what the *review* adds to a record: the decision
 * block, which is a control rather than content, and the pick's local state,
 * which a verdict button commits. The record page passes neither. It is
 * read-only by construction — deciding a record is something you do inside its
 * review — so the tick it shows is the verdict's own selection and there is no
 * Select under any tab.
 *
 * `comment` is how a caller offers to start a thread on a section. The record
 * page passes none, which is the owner's word (*"let's leave out the comments
 * for now"*) rather than an omission, and a section with nothing offered simply
 * has nothing under it.
 */
export function RecordNarrative({
  record,
  picked,
  readOnly,
  onPick,
  comment,
}: {
  record: RecordDetail['record']
  /**
   * Which solution wears the tick: the verdict's selection on a decided record,
   * the AI's recommendation while it is pending, and null where there is no
   * choice to make.
   */
  picked: number | null
  readOnly: boolean
  /** Absent on a surface that cannot pick one — the strip then offers no Select. */
  onPick?: (position: number) => void
  comment?: (section: RecordSection) => ReactNode
}) {
  /**
   * The record's only solution, when it proposes exactly one — and `undefined`
   * on every other shape, which is the two questions this branch has to answer
   * asked once. A record with one solution has nothing to choose between, and
   * the pick stays `null`: with a single solution the answer is structurally the
   * AI's recommendation and the server's existing fallback already records it,
   * so there is nothing for the reviewer to say and nothing lost by his not
   * saying it (`r-single-solution-no-tabs`).
   */
  const only = record.solutions?.length === 1 ? record.solutions[0] : undefined

  const commentOn = (section: RecordSection) => comment?.(section)

  return (
    <>
      <Section section="problem" comment={commentOn('problem')}>
        <Prose text={record.problem} testId="prose-problem" />
      </Section>

      <Section section="human_words" comment={commentOn('human_words')}>
        {/**
         * The one section nothing may reinterpret. A verbatim quote is what the
         * human actually said and the cleaned line is a restatement of the same
         * words, so neither goes near the markdown renderer: a parse would edit
         * the person being quoted, and asterisks inside a quote are his.
         *
         * `whitespace-pre-line` rather than nothing, because the collapse is the
         * defect the record names — he dictates in lines, and they were arriving
         * as one. Newlines back, nothing else read.
         */}
        <div className="flex flex-col gap-3">
          {record.humanWords.map((words) => (
            <div key={words.verbatim} className="flex flex-col gap-1">
              <blockquote
                className="whitespace-pre-line border-hairline border-l-2 pl-3 text-sm italic leading-relaxed"
                data-testid="human-words-verbatim"
              >
                {words.verbatim}
              </blockquote>
              <p
                className="whitespace-pre-line text-muted-foreground text-sm"
                data-testid="human-words-cleaned"
              >
                {words.cleaned}
                {words.context === null ? null : ` (${words.context})`}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section section="root_cause" comment={commentOn('root_cause')}>
        {/**
         * `r-incident-line-overflow` (retro 5, approved): every one of these
         * rows is a flex pair, and a flex item's automatic minimum size is its
         * own min-content — which for a line holding a token nothing can break
         * is that whole token. Left alone the cell lays out at 1231px inside a
         * 678px row, and the reader loses the end of the incident line with no
         * scrollbar to say there was more, because a record's slot clips for the
         * departure animation.
         *
         * Two clamps, and each does exactly one half. `min-w-0` — the record's
         * own direction — lets the *cell* shrink to the room the row has;
         * without it the box hangs off the row. `break-words` lets the *token*
         * fit the cell; without it the box is clamped and the text runs out of
         * it instead, which is the same lost line one box further in. Both were
         * hand-run alone and each leaves half the failure standing.
         */}
        {/**
         * One label system for the whole chain (retro 4 `r-whys-labels`, his
         * screenshot the reference): INCIDENT · WHY 1 … WHY n · ROOT, all caps,
         * each label on the line its text starts on and every label the same
         * width. It shipped as four separate choices — an unlabelled incident
         * line, a lowercase "why" against an all-caps ROOT, a label folding onto
         * two lines, and a width that came from whatever was beside it — because
         * the section was styled per element as it grew.
         *
         * The width and the wrap live in `.gutter-label`; nothing here sets its
         * own, which is the point.
         */}
        <div className="flex flex-col gap-2">
          <div className="flex gap-2" data-testid="root-cause-incident">
            <span className="gutter-label" data-testid="gutter-label">
              Incident
            </span>
            <Prose
              text={record.rootCause.whatHappened}
              testId="prose-what-happened"
              className={GUTTER_PROSE}
            />
          </div>
          <ol className="flex list-none flex-col gap-1" data-testid="root-cause-whys">
            {record.rootCause.whys.map((why, index) => (
              <li key={why} className="flex gap-2">
                <span className="gutter-label" data-testid="gutter-label">
                  Why {index + 1}
                </span>
                {/* A why is written as "**Why did X?** because Y" — the bold
                    half is the question, and it is the half that is skimmed. */}
                <Prose text={why} testId="prose-why" className={GUTTER_PROSE} />
              </li>
            ))}
          </ol>
          <div className="flex gap-2" data-testid="root-cause-root">
            <span className="gutter-label" data-testid="gutter-label">
              Root
            </span>
            <Prose text={record.rootCause.root} testId="prose-root" className={GUTTER_PROSE} />
          </div>
        </div>
      </Section>

      <Section section="workaround" comment={commentOn('workaround')}>
        <Prose text={record.workaround} testId="prose-workaround" />
      </Section>

      {/**
       * The two shapes a record can be in, and the card renders whichever it was
       * filed in (data-model.md §Record).
       *
       * A record filed before the owner's multi-solution design has one agreed
       * direction and one footprint, and it renders here exactly as it always
       * did — retros 1–5 are full of them, their comments are anchored to those
       * two sections, and human data is never rewritten to suit a newer page.
       */}
      {record.solutions === null ? (
        <>
          <Section section="direction" comment={commentOn('direction')}>
            <Prose text={record.agreedDirection ?? ''} testId="prose-direction" />
          </Section>

          <Section section="footprint" comment={commentOn('footprint')}>
            {/**
             * A drawing, not prose, and the one field on the page whose runs of
             * spaces carry meaning: an author-aligned file tree, box characters
             * and a column of [CREATE]/[UPDATE]/[DELETE] tags. It goes nowhere
             * near the markdown renderer — a parse would read its indentation as
             * list structure — and it is preformatted rather than merely
             * newline-keeping, because `pre-line` preserves the newlines and then
             * collapses the very spaces the columns are made of.
             *
             * `overflow-x-auto` so a wide tree scrolls inside its own box: the
             * page does not scroll sideways on the iPad, and the drawing is not
             * rewrapped into something its author did not draw.
             */}
            <pre
              className="meta-mono overflow-x-auto whitespace-pre"
              data-testid="section-footprint-text"
            >
              {record.footprint}
            </pre>
          </Section>
        </>
      ) : (
        <Section section="solutions" comment={commentOn('solutions')}>
          {/**
           * One solution is not a choice, and choice chrome around it is the
           * page asking a question with one answer — the owner, on the strip he
           * had just been shown: *"When there is only one solution, you
           * shouldn't show the tab because showing the tab causes confusion."*
           * The branch is here rather than inside `SolutionTabs` so that
           * component stays honest about being a strip
           * (`r-single-solution-no-tabs`).
           */}
          {only === undefined ? (
            <SolutionTabs
              solutions={record.solutions}
              picked={picked}
              readOnly={readOnly}
              onPick={onPick}
            />
          ) : (
            <SoloSolution solution={only} />
          )}
        </Section>
      )}
    </>
  )
}

/**
 * The AI's proposals, as the owner drew them: *"3 different solutions each in a
 * tab within the retro card. The title of the tab would be like Solution 1,
 * Solution 2 etc. And then some indication like a `*` that shows what is
 * solution recommended by the AI and then a tickmark that indicates what the
 * human actually selected. also within the tab title it should mention L1 … L5
 * so that the human can see what is the level of the solution."*
 *
 * The array arrives sorted lowest level first and tab N is position N, so
 * "Solution 2" is a fact about the record rather than a label this decides —
 * the write path refuses an unsorted array, which is what makes the number
 * stable enough for the human's pick to be an index into it.
 *
 * **The two markers say one thing between them: whether the tick has moved.**
 * The ✓ is where the verdict is going, and it starts on the AI's recommendation
 * (`r-recommended-preselected`). The `*` is what the AI had recommended, and it
 * renders only once the pick is somewhere else — so a strip wearing both markers
 * means exactly one thing, that the reviewer overrode the recommendation, and a
 * strip wearing only the tick means he agrees with it. That is the owner's own
 * simplification: *"the star should only show if I select another option — then
 * it shows the star on the one that was previously recommended by the AI. Right
 * now it shows the star and also the checkmark."*
 *
 * Each marker is a character *and* a word in the tab's accessible name: colour
 * says nothing here, and neither does a shape alone to a reader who cannot see
 * it.
 *
 * Opening a tab is reading, not deciding. The tick moves only when the reviewer
 * presses the tab's own Select, and even that writes nothing until a verdict is
 * pressed — the same contract the three dials have.
 */
function SolutionTabs({
  solutions,
  picked,
  readOnly,
  onPick,
}: {
  solutions: NonNullable<RecordDetail['record']['solutions']>
  picked: number | null
  readOnly: boolean
  /** Absent where nothing may be picked — the record page, which is not a review. */
  onPick?: (position: number) => void
}) {
  const recommended = recommendedPosition(solutions)

  return (
    <Tabs defaultValue={String(picked ?? recommended)} data-testid="solution-tabs">
      <TabsList data-testid="solution-tab-strip">
        {solutions.map((solution, index) => {
          const position = index + 1
          return (
            <TabsTrigger
              key={`${position}:${solution.level}`}
              value={String(position)}
              data-testid={`solution-tab-${position}`}
            >
              {`Solution ${position} · L${solution.level}`}
              {/* Only on divergence, and only on the tab the AI had picked: with
                  the tick sitting there too it would be two marks saying the
                  same thing, which is the pair the owner asked to break up. */}
              {solution.recommended && picked !== recommended ? (
                <Marker
                  symbol="*"
                  name="recommended by the AI"
                  testId={`solution-tab-${position}-recommended`}
                />
              ) : null}
              {picked === position ? (
                <Marker symbol="✓" name="selected" testId={`solution-tab-${position}-selected`} />
              ) : null}
            </TabsTrigger>
          )
        })}
      </TabsList>

      {solutions.map((solution, index) => {
        const position = index + 1
        return (
          <TabsContent
            key={`${position}:${solution.level}`}
            value={String(position)}
            className="flex flex-col gap-2"
            data-testid={`solution-${position}`}
          >
            {/**
             * **The level leads the body** (`r-level-legend-below-fold`, the
             * owner: *"you need to add an item to move the Level right after the
             * tabs so that the user can immediately see what L2 means"*).
             *
             * The tab title says `L2` and this line is the only place the page
             * says what L2 *means*. It was the last element of the body — after
             * the bullets and after the footprint — so on a session-9-sized
             * solution the gloss was a screen below the tab that named it, and
             * the one decision the strip exists for (choosing between ceilings)
             * was made before its meaning scrolled into view.
             *
             * A tab body opens directly under the strip, so first here *is*
             * directly under the tab. Same line, moved: no new element and no
             * new prose — and it is now the same order the single-solution
             * branch has always had, which is one order for a solution instead
             * of two.
             *
             * The bold leads in the bullets are authored content — the renderer
             * reads them, nothing here restyles them.
             */}
            <SolutionLevel position={position} level={solution.level} />
            <Prose text={solution.bullets} testId={`prose-solution-${position}`} />
            <SolutionFootprint position={position} footprint={solution.footprint} />
            {/**
             * The one control in here, and it is on the tabs it can do something
             * to: the tab already wearing the ✓ offers nothing to press, because
             * a button whose only outcome is the state you are in is a label
             * pretending to be a control (KC-0014). Gone entirely on a read-only
             * review, with every other control on the card.
             */}
            {readOnly || picked === position || onPick === undefined ? null : (
              <Button
                variant="outline"
                size="sm"
                className="w-fit"
                data-testid={`solution-${position}-select`}
                onClick={() => onPick(position)}
              >
                Select this solution
              </Button>
            )}
          </TabsContent>
        )
      })}
    </Tabs>
  )
}

/**
 * Which solution the AI is behind, 1-based, from the flag on the array — the one
 * place that answer is computed, so the tab that opens, the tab that is ticked
 * on arrival and the tab that wears the `*` on divergence cannot disagree. Two
 * copies of this were two chances for them to.
 *
 * The `|| 1` is for a record whose flag went missing: something has to be open.
 */
function recommendedPosition(solutions: NonNullable<RecordDetail['record']['solutions']>): number {
  return solutions.findIndex((solution) => solution.recommended) + 1 || 1
}

/**
 * The record that proposes one solution, rendered as the answer it is.
 *
 * No strip, because there is nothing to switch between; no Select, because
 * *"when there is only one solution it shouldn't require me to select the
 * solution — there is no point to it"*; and no tick, because a tick is the
 * answer to a question that was not asked. What the reviewer decides here is the
 * record, in the decision block below, exactly as on a record that proposes
 * none.
 *
 * **The level leads** — *"the level of the solution should probably come on the
 * top"*. It led here first, because with no strip to carry it in a tab title the
 * level would otherwise arrive last, after the thing it is the size of. The tab
 * body leads with it too since `r-level-legend-below-fold`, so the two shapes now
 * order a solution the same way and this branch is no longer the exception.
 *
 * The testids are the strip's own, because a solution is a solution: a scenario
 * asking what solution 1 says, or what its footprint draws, asks the same
 * question of both shapes and the answer comes back in the same words
 * (`r-single-solution-no-tabs`).
 */
function SoloSolution({
  solution,
}: {
  solution: NonNullable<RecordDetail['record']['solutions']>[number]
}) {
  return (
    <div className="flex flex-col gap-2" data-testid="solution-1">
      <SolutionLevel position={1} level={solution.level} />
      <Prose text={solution.bullets} testId="prose-solution-1" />
      <SolutionFootprint position={1} footprint={solution.footprint} />
    </div>
  )
}

/**
 * A solution's footprint: a drawing, framed as the block it is.
 *
 * Three things, and the owner named all three (`r-footprint-block-presentation`):
 * *"The change footprint right now seems squeezed between the bullet points and
 * the L1. Add some vertical margin so it stands on its own, a border that shows
 * this is a code block — because it appears as a code block — and give it a
 * title, something like 'Change footprint', so it's clear what this section is.
 * It shows me how big of a change this is."*
 *
 * The margin is on top of the body's own gap, because the complaint was about a
 * block that read as squeezed between the two things it sits between. The border
 * is the hairline every card on this page is drawn with, so the frame is the
 * app's own rule rather than a second one invented here; the caption is
 * `.section-label`, which is what every other small-caps label on the page is.
 * Nothing else — no fill, no heading level, no icon.
 *
 * **Both shapes hand their footprint here**, the tab body and the single-solution
 * branch, so the block cannot come to read one way in one place and another in
 * the other. A record filed before solutions is not one of them: its footprint is
 * a section with a heading of its own and it renders exactly as it always did.
 *
 * The drawing itself is unchanged. Preformatted for the reason the record's own
 * footprint is — an author-aligned tree whose runs of spaces are its columns, so
 * it goes nowhere near the markdown renderer — and `overflow-x-auto` still keeps
 * a wide line inside its own box rather than on the page's, which is now the
 * frame's inside rather than the card's.
 */
function SolutionFootprint({ position, footprint }: { position: number; footprint: string }) {
  return (
    <div
      className="my-1 flex flex-col gap-1.5 rounded-md border border-hairline px-3 py-2.5"
      data-testid={`solution-${position}-footprint-block`}
    >
      <p className="section-label" data-testid={`solution-${position}-footprint-caption`}>
        Change footprint
      </p>
      <pre
        className="meta-mono overflow-x-auto whitespace-pre"
        data-testid={`solution-${position}-footprint`}
      >
        {footprint}
      </pre>
    </div>
  )
}

/**
 * The canonical level label, both halves. The explanatory half is never dropped
 * for brevity — the owner's standing rule (`enum-labels.ts`).
 */
function SolutionLevel({ position, level }: { position: number; level: number }) {
  const option = optionFor(SOLUTION_LEVELS, level)
  return (
    <p className="text-sm leading-relaxed" data-testid={`solution-${position}-level`}>
      {option === undefined ? (
        `Level ${level}`
      ) : (
        <>
          <span className="font-semibold">{option.name}</span>
          {option.rest}
        </>
      )}
    </p>
  )
}

/**
 * A tab's marker: the character the owner named, and the word it stands for.
 *
 * The word is not decoration. `*` and `✓` are two glyphs a reader has to have
 * been told the meaning of, and a screen reader would otherwise announce the
 * tab as "Solution 2 · L2 star" — so the symbol is hidden from the accessibility
 * tree and the name is spoken in its place, which makes the tab's whole name
 * read "Solution 2 · L2 (recommended by the AI) (selected)".
 */
function Marker({ symbol, name, testId }: { symbol: string; name: string; testId: string }) {
  return (
    <span data-testid={testId}>
      <span aria-hidden>{symbol}</span>
      <span className="sr-only">{` (${name})`}</span>
    </span>
  )
}

/**
 * The heading is read from the shared vocabulary rather than passed in
 * (`lib/enum-labels.ts`): the panel prints the same word on a thread filed under
 * this section, and two copies of "Agreed direction" is one copy too many.
 */
function Section({
  section,
  comment,
  children,
}: {
  section: RecordSection
  comment: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-2" data-testid={`section-${section}`}>
      {/**
       * The heading and its comment glyph, in one inline run
       * (`r-comment-button-below-section`, the owner: *"each of the comment
       * button should be next to the sesion it is for rather than at the
       * bottom"*, with his plugin-ledger screenshot as the reference).
       *
       * The affordance used to render after `{children}` — after the problem
       * bullets, after the human-words block — so on a session-9-sized section
       * the way to comment on a section was a screen below the heading that
       * named it, and it read as belonging to whatever came last rather than to
       * the section.
       *
       * The heading is `inline` and the glyph is its sibling rather than its
       * child, which is what keeps the two facts apart: the glyph flows
       * immediately after the heading's last word the way his ledger draws it,
       * and the heading's accessible name stays the section's name instead of
       * gaining the button's. A screen reader listing this record's headings
       * would otherwise read "Problem, comment on Problem".
       */}
      <div className="leading-none">
        <h3 className="section-label inline" data-testid="heading-label">
          {SECTION_TITLES[section]}
        </h3>
        {comment}
      </div>
      {children}
    </section>
  )
}

/**
 * The one thing a section still offers about comments: a way to start one on it.
 *
 * The threads themselves left — *"Replace inline comments in retro body with
 * comments in the side panel (look at the old UI how it was done there) - This
 * enables human to see all comments in one place"* — and the affordance they
 * were under stayed, because the alternative is asking the reviewer to say which
 * section they meant after they have already pointed at it. Pressing it aims the
 * panel's composer here and puts the panel in front of them; nothing about this
 * card changes.
 *
 * **It is a glyph rather than a button with a word on it, and it sits inline
 * after the name of the thing it comments on** — the owner's ledger pattern,
 * asked for twice in one round: *"each of the comment button should be next to
 * the sesion it is for rather than at the bottom"*
 * (`r-comment-button-below-section`) and *"I want abillity to post a comment at
 * the title level as well for a record"* (`r-title-comments-unreachable`), whose
 * reviewer note fixes the placement exactly: *"make sure that the comment is
 * incline with the title … it should be right next to the last word of the
 * title. it shouldn't be separate on the right etc."*
 *
 * **One component for both, which is what makes them one pattern.** A section
 * heading and the record's own title are the same kind of thing here — a name
 * with a thread behind it — and two components would be two places for the glyph
 * to drift apart. The `title` section is not a new thread kind: it has been a
 * first-class comment section in the model, the CLI and `SECTION_TITLES` all
 * along, and this is the affordance that was missing from the one layer the
 * human uses.
 *
 * The word survives where a word is still owed: `sr-only` for a reader who
 * cannot see the glyph, and `title` for a pointer that hovers it. A bare icon
 * with neither would be a control only the person who built it can identify.
 *
 * Gone entirely on a read-only review, along with every other control: a
 * finished review takes no comments and the server refuses one, so a button
 * whose only outcome is an error would be the page disagreeing with the domain.
 */
function SectionComment({
  rid,
  section,
  readOnly,
  onComment,
}: {
  rid: string
  section: RecordSection
  readOnly: boolean
  onComment: (rid: string, section: RecordSection) => void
}) {
  if (readOnly) return null

  const name = `Comment on ${SECTION_TITLES[section].toLowerCase()}`
  return (
    <button
      type="button"
      // `align-middle` rather than the baseline: the glyph is a square and the
      // text beside it is 11px small-caps in one place and an 18px title in the
      // other, so centring it on the line is the only alignment that reads the
      // same in both.
      className="ml-1.5 inline-flex translate-y-px items-center rounded-sm align-middle text-muted-foreground transition-colors hover:text-foreground"
      data-testid="open-thread"
      title={name}
      onClick={() => onComment(rid, section)}
    >
      <MessageSquarePlusIcon aria-hidden className="size-3.5" />
      <span className="sr-only">{name}</span>
    </button>
  )
}

/**
 * The two clamps a gutter row's prose cell needs so a token nothing can break
 * narrows instead of taking the line off the page (retro 5
 * `r-incident-line-overflow`). Written once and handed to all three row kinds,
 * because the pattern copy-propagated into the third one is how the record came
 * to be filed in the first place.
 */
const GUTTER_PROSE = 'min-w-0 break-words'
