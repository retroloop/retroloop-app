Feature: Reviewing a revision

  The review page is where a human decides, record by record, what the AI wrote
  down. Every decision on it is an explicit act: nothing here is settled by
  silence, by time passing, or by the absence of a comment.

  Background:
    Given the reviewer opens retro 1

  # The click-through has to land somewhere the reader recognises: the name and
  # the identity line are the dashboard row's, restated.
  Scenario: The page opens by saying which retrospective this is and where it happened
    Then the review header names the retro "The lock, the arrows and the silent tailer"
    And the review header identifies it as "Session 1 · Retro #1 · /Users/sample/Developer/retro"

  # G1. Until this tag existed, a finished retrospective never said it was
  # finished anywhere near the top of the page: the reviewer had to reach the
  # bottom to find out that nothing they did up there would count. The word is
  # the dashboard row's word, so the two screens agree.
  #
  # Three words now, because the middle one indicates the human has submitted
  # but the AI hasn't closed. The walk is one scenario rather than three
  # because the claim is about the BOUNDARIES — a tag that changed one press
  # early or one press late still reads correctly at two of these three
  # points.
  Scenario: The header says what state the review is in, through the press and the close
    Then the review header says the retro is "reviewing"
    When the reviewer approves record "r-stale-lock"
    And the reviewer declines record "r-bullet-responses"
    And the reviewer approves record "r-silent-tailer"
    And the reviewer finishes the review
    # The human's press ends their side of the round and nothing more: the
    # retrospective is still `reviewing` in the store until the AI closes it.
    # SUBMITTED is the reading of that unchanged row, and it lands without a
    # reload — the finish invalidates retros.get and the header re-reads it.
    Then the review header says the retro is "submitted"
    When the AI closes the review
    Then the review is finished
    And the review header says the retro is "finished"

  # The half of the fourth word that a component could fake: it has to come back
  # from the store rather than out of this page's memory. Leaving and coming back
  # destroys the header and every hook under it, and the mock's world stands —
  # which is the same mechanism r-finish-button-reenables was proved with, and it
  # is proved here for the same reason. A tag driven from the finish mutation's
  # own result would read REVIEWING again on the way back.
  Scenario: The submitted word comes back from the store, not from this page
    When the reviewer approves record "r-stale-lock"
    And the reviewer approves record "r-bullet-responses"
    And the reviewer approves record "r-silent-tailer"
    And the reviewer finishes the review
    Then the review header says the retro is "submitted"
    When the reviewer leaves the review and comes back
    Then the review header says the retro is "submitted"
    And the browser reported no console errors

  Scenario: The records are listed in num order, each with its identity
    Then the records appear in the order "r-stale-lock, r-bullet-responses, r-silent-tailer"
    And record "r-stale-lock" shows "#1"
    And record "r-stale-lock" shows "issue"
    And record "r-stale-lock" shows "Deploy blocked on a stale lock file"
    And record "r-bullet-responses" shows "feature"

  # There used to be no distinction on the page between a retro item reported
  # or requested by the human versus by the AI. Every record has carried
  # `requester` since the first schema and nothing on the page ever said it. The
  # header is where a reader meets a record, so that is where it says whose
  # complaint this is — and it is a tag, in the idiom every other status uses.
  Scenario: A record says whether the human or the AI asked for it
    Then record "r-stale-lock" is requested by "HUMAN"
    And record "r-silent-tailer" is requested by "AI"

  Scenario: A record shows the whole narrative that is under review
    Then record "r-stale-lock" shows the sections "problem, human_words, root_cause, workaround, solutions"
    And record "r-bullet-responses" shows the sections "problem, human_words, root_cause, workaround, direction, footprint"
    And record "r-stale-lock" shows "nothing in the refusal says which"
    And record "r-stale-lock" shows "it says the port is taken and it is NOT taken, i checked"
    And record "r-stale-lock" shows "The refusal claims the port is in use when it is not."
    And record "r-stale-lock" shows "The lock file outlived the process that wrote it."
    And record "r-stale-lock" shows "The lock records that someone held it, not who"
    And record "r-stale-lock" shows "Delete the lock file by hand before starting."
    And record "r-stale-lock" shows "Write the pid into the lock"
    And record "r-stale-lock" shows "apps/cli/src/server/lock.ts"

  # The AI now files the evidence it diagnosed from — log lines, timings,
  # the commands it ran — on every record. It is the one block on a card that
  # starts closed, and that is not the "a record is read in full" rule bending:
  # what is behind it is not part of what the reviewer is deciding. It anchors no
  # comment, no verdict is about it, and the finish gate does not know it exists.
  # Left open it would be a screen of pasted output on every record of the round.
  #
  # Three claims in one walk, because they are one behaviour seen at three
  # moments: it is there and closed, a click opens it, and what comes out is
  # rendered rather than shown as its source — the same subset, through the same
  # renderer, as every other prose field on the card.
  Scenario: The diagnostic data is on the card, folded away until it is asked for
    Then record "r-stale-lock" keeps its diagnostic data folded away
    When the reviewer opens the diagnostic data of record "r-stale-lock"
    Then the "diagnostic-data" prose of record "r-stale-lock" has the bold leads:
      | The lock file: |
      | The holder:    |
    And the "diagnostic-data" prose of record "r-stale-lock" fences exactly:
      """
      $ retro up
      refusing: the stage is already being served
      """
    And the "diagnostic-data" prose of record "r-stale-lock" is built only from the safe subset

  # The block is display only: it is evidence the AI gathered, not a proposal the
  # human answers, so there is nowhere on it to start a thread. Every other
  # section of a record carries that affordance next to its heading, which is what
  # makes its absence here a claim worth making rather than a thing nobody added.
  Scenario: There is no way to comment on the diagnostic data
    When the reviewer opens the diagnostic data of record "r-stale-lock"
    Then record "r-stale-lock" offers no way to comment on its diagnostic data

  # A record filed before the field existed carries none, and the block is not
  # there at all — not an empty one, and not one that opens onto nothing. Two of
  # the three records in this round are in that state, which is also the state
  # every record of the product's earliest retrospectives is in.
  Scenario: A record filed before the field existed has no diagnostic data block
    Then record "r-bullet-responses" has no diagnostic data block
    And record "r-silent-tailer" has no diagnostic data block

  # The root-cause chain shipped as four
  # separate styling choices: the what-happened line carried no label at all,
  # "why" was lowercase against an all-caps ROOT, the label folded onto a second
  # line, and each label's width came from the text beside it. These three
  # scenarios are the label system that replaces it — one case, one line, one
  # width.
  Scenario: The root cause is one label system, from INCIDENT to ROOT
    Then the root-cause labels of record "r-stale-lock" read:
      | INCIDENT |
      | WHY 1    |
      | WHY 2    |
      | WHY 3    |
      | WHY 4    |
      | ROOT     |
    And the root-cause labels of record "r-silent-tailer" read:
      | INCIDENT |
      | WHY 1    |
      | WHY 2    |
      | WHY 3    |
      | WHY 4    |
      | WHY 5    |
      | ROOT     |

  # The two geometry claims, on the iPad in portrait — the screen the review
  # is read on, and the width where a gutter that sizes itself off the prose
  # beside it has least room to stay on one line. Both are controlled
  # assertions (testing.md §Operational rules): each was hand-run with the
  # shared width deleted before it shipped.
  Scenario: A root-cause label is one line, whatever the text beside it says
    When the reviewer is on an iPad in portrait
    Then the root-cause labels of record "r-stale-lock" are one line each
    And the root-cause labels of record "r-silent-tailer" are one line each

  # Two records with different why counts and very different line lengths: the
  # label column is the same width in both, because it is not the text's to set.
  Scenario: Every root-cause label is the same width as the others
    When the reviewer is on an iPad in portrait
    Then the root-cause labels of record "r-stale-lock" are all the same width
    And the root-cause labels of record "r-silent-tailer" are all the same width

  # The INCIDENT row is a flex row whose prose cell lacks `min-w-0`, so a
  # fenced block or one long unbroken token in `whatHappened` can floor
  # min-content above the column width and force horizontal overflow. The
  # pattern predates this fix on the why/root rows; the label work extended
  # it by one more row.
  #
  # It was reviewer-flagged rather than observed, because nothing in the fixture
  # had a token that could not wrap. One does now — the cursor the tailer died
  # holding, 150 characters of base64 with nothing in it to break at — so the
  # claim is checkable at the two widths that bracket the reading column: the
  # laptop, where the column shares the page with two rails, and the portrait
  # iPad, where it is the page.
  #
  # Note what it does *not* do: the page does not scroll sideways when this goes
  # wrong, because a record's slot clips for the departure animation. The line is
  # simply cut off at the card's edge, with nothing to say there was more of it —
  # which is why this scenario measures the row rather than the page.
  Scenario Outline: A root-cause line with a token nothing can break narrows instead of running past the column
    Given the reviewer's screen is <width> by <height>
    And the reviewer opens retro 1
    Then the root-cause lines of record "r-silent-tailer" stay inside their column
    And the browser reported no console errors

    Examples:
      | width | height |
      | 1440  | 900    |
      | 1024  | 1366   |

  # Every prose section is *authored*
  # as markdown and was rendered as its own source: `**bold**` put its asterisks
  # on the page, single newlines collapsed, and a list was a run-on line. A
  # record is meant to be read by skimming its bold leads, and that method
  # had no surface to work on — through three retrospectives.
  #
  # These scenarios are the rendering contract between what the AI writes and
  # what the human sees. The subset is small on purpose and everything outside it
  # is text: there is no path from an authored string to markup on this page.

  Scenario: A bold lead renders bold, and its asterisks are never on the page
    Then the "problem" prose of record "r-bullet-responses" has the bold leads:
      | Fragments, not sentences:  |
      | Worst where it costs most: |
    And no markdown syntax is visible on record "r-bullet-responses"

  Scenario: A bullet line becomes a list item, and a numbered line a numbered one
    Then the "problem" prose of record "r-bullet-responses" has the bullets:
      | Fragments, not sentences: asked for an explanation, the assistant answers in fragments joined by arrows. |
      | Worst where it costs most: the long answers, where reassembling the sentence is dearest.                 |
    And the "direction" prose of record "r-bullet-responses" has the numbered items:
      | Prose by default: say it in complete sentences and drop detail instead of grammar (agreed). |
      | No arrow chains: a line built from -> is a sentence that was skipped.                       |

  # A bullet indented under another is the sub-point its author meant, not a run
  # of literal dashes. One level is what the subset reads: indenting further is
  # still that one level, which is a stated limit rather than a silent
  # reinterpretation of what was written.
  Scenario: A bullet indented under another becomes a nested list item
    Then the "solution-2" prose of record "r-stale-lock" nests the bullets:
      | The check is the pid, not the file: a lock whose writer is gone is free, whatever the file says. |
    And no markdown syntax is visible on record "r-stale-lock"

  # Every newline used to be
  # structural, which made the house habit of wrapping prose at ~72 columns a
  # rendering bug: a wrapped bullet shattered into a bullet followed by bare
  # paragraphs, and a `**` that opened on one line and closed on the next put
  # its asterisks on the page — reading as broken text rather than formatted
  # prose.
  #
  # So a line that opens no block marker continues the block above it, which is
  # CommonMark's soft break. A blank line is still the paragraph boundary, and
  # this fixture — two sentences on two source lines with no blank between them —
  # is now the one paragraph the subset says it is.
  Scenario: A newline inside a block is a soft wrap, so the block reads as one paragraph
    Then the "workaround" prose of record "r-bullet-responses" reads the lines:
      | none — the reader reassembles it by hand. Asking for <b>prose</b> in the prompt does not stick. |

  # The first of the two breakages, as the author would write it:
  # a bullet wrapped at the column the house wraps everything else at. It stays
  # one bullet, and the sentence it carries is whole.
  Scenario: A bullet wrapped over two source lines is still one bullet
    When the AI replies on record "r-bullet-responses" with:
      """
      - **Prose by default:** say it in complete sentences and drop
        detail instead of grammar.
      - **No arrow chains:** a line built from -> is a sentence that
        was skipped.
      """
    And the reviewer opens the replies in the "direction" thread of record "r-bullet-responses"
    Then the newest "direction" comment of record "r-bullet-responses" has the bullets:
      | Prose by default: say it in complete sentences and drop detail instead of grammar. |
      | No arrow chains: a line built from -> is a sentence that was skipped.              |
    And no markdown syntax is visible in the comments panel

  # The second one: an inline mark that opens on one source line and closes on
  # the next. It used to be an unpaired `**` twice over — two asterisks on one
  # line and two on the other, both on the page as characters — because the parse
  # never saw the two halves as one string.
  Scenario: A bold span that opens on one line and closes on the next renders bold
    When the AI replies on record "r-bullet-responses" with:
      """
      Taken. The **fixed-column wrapping this file was
      written with** is no longer a rendering bug.
      """
    And the reviewer opens the replies in the "direction" thread of record "r-bullet-responses"
    Then the newest "direction" comment of record "r-bullet-responses" leads with the bold text "fixed-column wrapping this file was written with"
    And no markdown syntax is visible in the comments panel

  # Fenced code is in the subset by design. A fence is the
  # one place *inside* prose where nothing at all is read: the whitespace is the
  # content, and an asterisk or a tag between the fences is a character the
  # author typed, not an instruction to the renderer.
  Scenario: A fenced block is code, and nothing inside it is parsed
    Then the "workaround" prose of record "r-silent-tailer" fences exactly:
      """
        tailer: read failed  **not bold**  <b>not markup</b>
          retrying in 1s
      """
    And the "workaround" prose of record "r-silent-tailer" is built only from the safe subset

  # A reply must be given as a quote. It opens by replaying what it is
  # answering — the comment, cleaned, as bullets with bold leads — inside a
  # real quote, and answers underneath it. That needs a blockquote in the
  # subset, which is this half; the rule that mandates the shape is
  # SKILL.md's.
  #
  # The quote holds a list rather than a line, which is the whole reason it holds
  # blocks: a quote that could only carry a paragraph would put the dashes of
  # those bullets on the page, and every `contains` assertion would still pass.
  Scenario: A reply replays what it answers inside a real quote
    When the AI replies on record "r-bullet-responses" with:
      """
      > - **Prose by default:** say it in complete sentences.
      > - **No arrow chains:** a line built from -> is a sentence that was skipped.

      Both taken. Revision 3 rewrites the answer shape and drops the arrows.
      """
    And the reviewer opens the replies in the "direction" thread of record "r-bullet-responses"
    Then the newest "direction" comment of record "r-bullet-responses" quotes the bullets:
      | Prose by default: say it in complete sentences.                       |
      | No arrow chains: a line built from -> is a sentence that was skipped. |
    And the newest "direction" comment of record "r-bullet-responses" answers outside the quote with "Revision 3 rewrites the answer shape"
    And the newest "direction" comment of record "r-bullet-responses" is built only from the safe subset
    And no markdown syntax is visible in the comments panel

  # The quote has to read as a quote, and that cannot be one joined comparison:
  # the treatment promises a rule down the left and muted ink, and a dark
  # override that collapsed muted onto the foreground would leave the rule
  # standing and pass. Each channel is also read
  # against what is beside it, because a rule the colour of the surface is no
  # rule and ink the colour of the answer is no quote.
  Scenario Outline: The quote in a reply is ruled and muted in the <theme> theme
    Given the reviewer has set dark mode to "<theme>"
    When the AI replies on record "r-bullet-responses" with:
      """
      > - **Prose by default:** say it in complete sentences.

      Taken, in revision 3.
      """
    And the reviewer opens the replies in the "direction" thread of record "r-bullet-responses"
    Then the quote in the newest "direction" comment of record "r-bullet-responses" is ruled and muted

    Examples:
      | theme |
      | light |
      | dark  |

  # The one place on the page where nothing may be interpreted at all. A verbatim
  # quote is what the human actually said; a parser run over it would edit them,
  # and the cleaned line beside it is a restatement of the same words. Both get
  # their line breaks back and nothing else — the asterisks in this quote are
  # asterisks the human typed, and they stay on the screen as asterisks.
  Scenario: Human words keep their line breaks and are never parsed
    Then the "verbatim" human words of record "r-silent-tailer" read the lines:
      | the ipad just went dead, i thought i lost wifi |
      | no **error**, no spinner, nothing              |
    And the "cleaned" human words of record "r-silent-tailer" read the lines:
      | A stopped stream is indistinguishable from a lost connection. |
      | He read the silence as dropped wifi. (reviewing on the iPad)  |

  # The footprint is the one section that is not prose: it is an author-aligned
  # file tree, drawn in box characters with the [CREATE]/[UPDATE]/[DELETE] tags
  # lined up in a column. A markdown parse would read its indentation as
  # structure, and any whitespace-collapsing rendering would flatten the columns
  # it is made of — so it is rendered preformatted, exactly as authored. This is
  # the only place on the page where a run of spaces means something.
  Scenario: The footprint keeps the shape it was drawn in
    Then the footprint of record "r-bullet-responses" is preformatted
    And the footprint of record "r-bullet-responses" reads exactly:
      """
      /Users/sample/Developer/retro
      ├── CLAUDE.md              [UPDATE] the prose rule, stated once
      └── docs
          └── OPERATION.md       [UPDATE] the answer-shape check in the inner loop
      """

  # The multi-solution design: the AI can propose up to 3 different
  # solutions, each in a tab within the retro card. The tab title reads
  # Solution 1, Solution 2, and so on, with a * marking the one the AI
  # recommends and a tickmark marking the one the human actually selected.
  # The tab title also carries the solution's level, L1 through L5, and the
  # tabs are always sorted from the lowest-level solution to the highest.
  #
  # The fixture's recommendation is on the MIDDLE tab on purpose: with it on the
  # last one, a page that opened the last tab, marked the last tab, or read the
  # array backwards would satisfy every assertion below without reading the flag
  # at all (r-assertion-value-distinctiveness).
  Scenario: A record's solutions are tabs, lowest level first, with the AI's pick already taken
    Then the solution tabs of record "r-stale-lock" read:
      | Solution 1 · L1             |
      | Solution 2 · L2✓ (selected) |
      | Solution 3 · L4             |
    And the "✓" on solution tab 2 of record "r-stale-lock" is named "selected"

  # The recommended tab is open by default, and it arrives already ticked:
  # the recommended solution is pre-selected whenever there is more than one
  # solution. The `*` stays out of the way while the two agree, because a
  # star and a tick on the same tab were two marks saying one thing.
  Scenario: The recommended tab is the one open, and it arrives already ticked
    Then solution tab 2 of record "r-stale-lock" is the one open
    And solution tab 2 of record "r-stale-lock" is ticked
    And record "r-stale-lock" has exactly one ticked solution tab
    And record "r-stale-lock" shows no AI mark on any solution tab
    And solution 2 of record "r-stale-lock" shows "Write the pid into the lock"
    And solution 2 of record "r-stale-lock" reads the level "Level 2 — tune existing: behavior change inside artifacts that already exist"

  # The other marker state, and the round trip between them: the user has
  # the option to switch around and select another solution, and they will
  # then see a star on the one that was previously recommended, in case they
  # have selected something different. Switching back restores the agreement
  # state, so the two states are reachable in both directions rather than
  # one being a trapdoor.
  Scenario: Switching marks what the AI had recommended, and switching back takes the mark away
    When the reviewer selects solution 3 of record "r-stale-lock"
    Then solution tab 3 of record "r-stale-lock" is ticked
    And record "r-stale-lock" has exactly one ticked solution tab
    And solution tab 2 of record "r-stale-lock" carries the AI's mark and no tick
    And the "*" on solution tab 2 of record "r-stale-lock" is named "recommended by the AI"
    And the "✓" on solution tab 3 of record "r-stale-lock" is named "selected"
    When the reviewer selects solution 2 of record "r-stale-lock"
    Then solution tab 2 of record "r-stale-lock" is ticked
    And record "r-stale-lock" has exactly one ticked solution tab
    And record "r-stale-lock" shows no AI mark on any solution tab

  # The Level line moves right after the tabs, so the user can immediately
  # see what a level like L2 means.
  #
  # The tab strip leads with `Solution 2 · L2` and this line is the only place the
  # page says what L2 means. It was the last element of the body — after the
  # bullets and after the wrapped footprint — so on a large solution the
  # gloss sat a screen below the tab that named it, and the one decision the
  # strip exists for was made before its meaning scrolled into view.
  #
  # The same line, moved: the body order for the rest of it stands, and the
  # tab body now opens the way the single-solution branch always has.
  Scenario: A tab body leads with the level in full, then bullets, then the footprint
    When the reviewer opens solution tab 3 of record "r-stale-lock"
    Then solution 3 of record "r-stale-lock" is laid out as its level, then bullets, then a footprint
    And the "solution-3" prose of record "r-stale-lock" has the bold leads:
      | A lease, not a file:                    |
      | Everything that touches the stage conforms: |
    And solution 3 of record "r-stale-lock" reads the level "Level 4 — change contracts: others must conform; consumers updated and old data shimmed in the same change"

  # A solution's footprint is a drawing for the same reason the record's own one
  # was: an author-aligned tree whose runs of spaces are its columns. It is per
  # solution now, because the files a level-1 answer touches are not the files a
  # level-4 answer touches.
  Scenario: Each solution's footprint is preformatted, and they differ
    When the reviewer opens solution tab 1 of record "r-stale-lock"
    Then the footprint of solution 1 of record "r-stale-lock" is preformatted
    And the footprint of solution 1 of record "r-stale-lock" differs from solution 3

  # The change footprint used to sit squeezed between the bullet points and
  # the level line. It gets vertical margin so it stands on its own, a
  # border that shows this is a code block — because it appears as a code
  # block — and a title, "Change footprint", so it is clear what the section
  # is and how big the change is.
  #
  # The frame is read one channel at a time and against the card behind it: a
  # border painted in the card's own colour is a border nobody can see, and a
  # width check alone would pass on it.
  Scenario Outline: The solution footprint is a captioned, framed block in the <theme> theme
    Given the reviewer has set dark mode to "<theme>"
    Then the footprint of solution 2 of record "r-stale-lock" is framed
    And the footprint of solution 2 of record "r-stale-lock" is captioned "Change footprint"
    And the footprint of solution 2 of record "r-stale-lock" is preformatted

    Examples:
      | theme |
      | light |
      | dark  |

  # "Same treatment wherever a solution footprint renders" — the tab body and the
  # single-solution branch, which is the shape that has no tab body at all. One
  # component draws both, and this is the assertion that keeps it that way.
  Scenario: The one-solution record frames its footprint exactly as a tab body does
    When the AI files the next revision
    And the reviewer loads the announced revision
    Then the footprint of solution 1 of record "r-doctor-blind" is framed
    And the footprint of solution 1 of record "r-doctor-blind" is captioned "Change footprint"
    And the footprint of solution 1 of record "r-doctor-blind" is preformatted

  # And the direction the record is explicit about: a record filed before
  # solutions existed keeps its footprint section exactly as it shipped — its own
  # heading, no frame, no caption. Human data is never re-presented to suit a
  # newer page.
  Scenario: A legacy record's footprint section is untouched by the frame
    Then record "r-bullet-responses" shows the sections "footprint"
    And record "r-bullet-responses" keeps its footprint section unframed
    And record "r-silent-tailer" keeps its footprint section unframed

  # Opening a tab is reading, not deciding — the tick does not follow the eye.
  # The reviewer walks all three and presses a verdict without touching Select,
  # and what the verdict carries is the recommendation that was never moved:
  # no Select press is required to agree.
  #
  # The tick that survives the verdict is the round trip. The record reseeds from
  # the decision the server wrote, so a payload that carried the tab last
  # *looked* at would come back ticking solution 3.
  Scenario: Reading another tab is not choosing it, and agreeing takes no press at all
    When the reviewer opens solution tab 1 of record "r-stale-lock"
    And the reviewer opens solution tab 3 of record "r-stale-lock"
    Then solution tab 2 of record "r-stale-lock" is ticked
    And record "r-stale-lock" has exactly one ticked solution tab
    When the reviewer approves record "r-stale-lock"
    Then record "r-stale-lock" is "approved"
    And solution tab 2 of record "r-stale-lock" is ticked
    And solution tab 2 of record "r-stale-lock" is the one open
    And record "r-stale-lock" shows no AI mark on any solution tab

  # The tick, and what pays for it: a tickmark that indicates what the human
  # actually selected. It is the human's act and nothing else writes it, so
  # it appears the moment Select is pressed, and it is on a different tab
  # from the `*` — which is the only arrangement that shows the two markers
  # are two things.
  #
  # And it is still on that tab after the verdict, which is the round trip: the
  # record reseeds from the decision the server wrote, so a payload carrying the
  # wrong index would come back ticking a different tab (or be refused outright,
  # and the verdict would never land at all).
  Scenario: Selecting a solution ticks it, and the verdict records that one
    When the reviewer opens solution tab 3 of record "r-stale-lock"
    And the reviewer selects solution 3 of record "r-stale-lock"
    Then solution tab 3 of record "r-stale-lock" is ticked
    And the "✓" on solution tab 3 of record "r-stale-lock" is named "selected"
    And solution tab 2 of record "r-stale-lock" carries the AI's mark and no tick
    When the reviewer approves record "r-stale-lock"
    Then record "r-stale-lock" is "approved"
    And solution tab 3 of record "r-stale-lock" is ticked
    And record "r-stale-lock" has exactly one ticked solution tab
    And solution 3 of record "r-stale-lock" reads the level "Level 4 — change contracts: others must conform; consumers updated and old data shimmed in the same change"

  # The tab a decided record opens on is the one it decided, not the one the AI
  # recommended — a reviewer coming back to a record reads what was approved
  # first. The Select control is gone from that tab for the same reason a pressed
  # verdict is not offered twice: there is nothing there to press.
  Scenario: A decided record opens on the solution it decided
    When the reviewer opens solution tab 1 of record "r-stale-lock"
    And the reviewer selects solution 1 of record "r-stale-lock"
    And the reviewer approves record "r-stale-lock"
    Then solution tab 1 of record "r-stale-lock" is the one open
    And solution tab 1 of record "r-stale-lock" is ticked
    And solution 1 of record "r-stale-lock" offers no Select

  # Selecting is a control, and a finished review takes none of them. What
  # survives is the reading: the tabs still open, and the tick still says which
  # ceiling was approved — in the tab's own title and again in full underneath
  # it, which is why the decision block no longer prints a second copy.
  Scenario: A finished review still shows which solution was chosen, and offers no way to change it
    When the reviewer opens solution tab 3 of record "r-stale-lock"
    And the reviewer selects solution 3 of record "r-stale-lock"
    And the reviewer approves record "r-stale-lock"
    And the reviewer declines record "r-bullet-responses"
    And the reviewer approves record "r-silent-tailer"
    And the reviewer finishes the review
    And the AI closes the review
    Then the review is finished
    And solution tab 3 of record "r-stale-lock" is the one open
    And solution tab 3 of record "r-stale-lock" is ticked
    And record "r-stale-lock" offers no Select on any solution
    And solution 3 of record "r-stale-lock" reads the level "Level 4 — change contracts: others must conform; consumers updated and old data shimmed in the same change"
    And the decision block of record "r-stale-lock" prints no solution level of its own
    And the "solution-level" of record "r-bullet-responses" reads "Level 1 — words only: guidance text; nothing executes it, nothing conforms to it"

  # The strip is a real tablist, so it is operable from the keyboard the way a
  # tablist is: one stop in the tab order, arrows between the tabs, Home and End
  # to the ends, and `aria-selected` saying which is open. None of that is
  # decoration — this is the control the record's whole verdict turns on.
  Scenario: The tab strip is operable from the keyboard
    Then the solution strip of record "r-stale-lock" is one stop in the tab order
    When the reviewer puts the keyboard on the solution strip of record "r-stale-lock"
    Then the keyboard is on solution tab 2 of record "r-stale-lock"
    When the reviewer presses "ArrowRight"
    Then solution tab 3 of record "r-stale-lock" is the one open
    And the keyboard is on solution tab 3 of record "r-stale-lock"
    When the reviewer presses "Home"
    Then solution tab 1 of record "r-stale-lock" is the one open
    And the keyboard is on solution tab 1 of record "r-stale-lock"
    When the reviewer presses "End"
    Then solution tab 3 of record "r-stale-lock" is the one open
    And the solution strip of record "r-stale-lock" leaves the keyboard on the open tab

  # Which tab is open has to be readable at a glance, and it cannot be a colour:
  # both themes, one channel at a time, because a fill that a dark override
  # suppresses leaves the ink and the border standing and a joined assertion
  # would pass on either.
  Scenario Outline: The open tab stands out from the closed ones, in the <theme> theme
    Given the reviewer has set dark mode to "<theme>"
    When the reviewer selects solution 3 of record "r-stale-lock"
    Then the open solution tab of record "r-stale-lock" stands out from the closed ones
    And every marker on the solution tabs of record "r-stale-lock" carries a symbol and a word
    And solution tab 3 of record "r-stale-lock" is ticked
    And solution tab 2 of record "r-stale-lock" carries the AI's mark and no tick

    Examples:
      | theme |
      | light |
      | dark  |

  # The other marker state at the same two themes: the strip a record
  # arrives in, wearing the tick alone. Both states are
  # checked in both themes because the strip is where the whole verdict is read,
  # and a mark that only renders in one theme is a mark half the reading loses.
  Scenario Outline: The tab the record arrives on stands out and wears only the tick, in the <theme> theme
    Given the reviewer has set dark mode to "<theme>"
    Then the open solution tab of record "r-stale-lock" stands out from the closed ones
    And every marker on the solution tabs of record "r-stale-lock" carries a symbol and a word
    And solution tab 2 of record "r-stale-lock" is ticked
    And record "r-stale-lock" shows no AI mark on any solution tab

    Examples:
      | theme |
      | light |
      | dark  |

  # The two shapes, side by side on one page, swept in both directions. A record
  # filed before solutions existed renders its agreed direction and its footprint
  # exactly as it always did — retros 1-5 are full of them, human data is never
  # rewritten, and the branch that renders one is not allowed to rot.
  Scenario: The two record shapes render side by side, each as itself
    Then record "r-stale-lock" shows the sections "solutions"
    And record "r-stale-lock" does not show the sections "direction, footprint"
    And record "r-bullet-responses" shows the sections "direction, footprint"
    And record "r-bullet-responses" does not show the sections "solutions"
    And record "r-stale-lock" has one solution tab strip and no stacked solution list
    And record "r-bullet-responses" has no solution tab strip

  # When there is only one solution, the tab is not shown, because showing a
  # single tab causes confusion. In that scenario, the level of the solution
  # comes at the top instead.
  #
  # The record arrives with revision 3, because a record that did not exist in
  # the round before is the product's own way to reach this shape — no
  # arrangement flag has to invent it.
  Scenario: A record proposing one solution shows it whole, with the level leading
    When the AI files the next revision
    And the reviewer loads the announced revision
    Then record "r-doctor-blind" shows its one solution and no way to choose
    And solution 1 of record "r-doctor-blind" is laid out as its level, then bullets, then a footprint
    And solution 1 of record "r-doctor-blind" reads the level "Level 3 — add surface: something new that everything existing can safely ignore"
    And solution 1 of record "r-doctor-blind" shows "the doctor opens the stage the way the server does"
    And the footprint of solution 1 of record "r-doctor-blind" is preformatted

  # When there is only one solution, selecting it is not required — there is
  # no point to it. With one solution the pick is
  # structurally the AI's recommendation and the server's own fallback records
  # it, so the verdict carries no selection and nothing is lost by that: the
  # record comes back decided, still showing the solution it was decided on.
  Scenario: A one-solution record takes a verdict without ever being selected
    When the AI files the next revision
    And the reviewer loads the announced revision
    And the reviewer approves record "r-doctor-blind"
    Then record "r-doctor-blind" is "approved"
    And record "r-doctor-blind" shows its one solution and no way to choose
    And solution 1 of record "r-doctor-blind" reads the level "Level 3 — add surface: something new that everything existing can safely ignore"

  # Counted both ways on one page, which is the only arrangement that shows the
  # branch reads the record rather than the round: the record with one solution
  # has no choice chrome at all, and the record with three keeps the strip
  # exactly as it shipped.
  Scenario: One solution drops the strip and three keep it, on the same page
    When the AI files the next revision
    And the reviewer loads the announced revision
    Then record "r-doctor-blind" has no solution tab strip
    And record "r-doctor-blind" shows its one solution and no way to choose
    And record "r-stale-lock" has one solution tab strip and no stacked solution list
    And solution tab 2 of record "r-stale-lock" is the one open
    And solution 2 of record "r-stale-lock" is laid out as its level, then bullets, then a footprint

  # The level radio is a dial only on a record that has a level of its own. On a
  # solutions record the ceiling comes with the solution the human picks, and a
  # second control setting it would be a second answer that can disagree.
  Scenario: The level radio is offered only on a record with a level of its own
    Then record "r-bullet-responses" offers the solution level radio
    And record "r-stale-lock" does not offer the solution level radio

  # A footprint is a drawing that can be wider than the column it is read in, and
  # a wide line that is not reachable is a line the reviewer has lost. It scrolls
  # inside its own box, and it does so at every width this product is read at —
  # all three canonical ones, plus the one where the column is at its narrowest.
  #
  # Since the reading column's breakpoint moved to 92rem, none of the
  # three canonical viewports has rails: on all of them the reading column is
  # most of the page. The column is narrowest at 1472, the breakpoint itself,
  # where it shares the row with both rails at its 704px floor — so that row is
  # here, because a box that scrolls at 1024 is not evidence about the width the
  # prose is actually tightest at.
  Scenario Outline: A footprint wider than the column scrolls inside its tab at <width> by <height>
    Given the reviewer's screen is <width> by <height>
    And the reviewer opens retro 1
    When the reviewer opens solution tab 3 of record "r-stale-lock"
    Then the footprint of solution 3 of record "r-stale-lock" scrolls inside its own box
    And the browser reported no console errors

    Examples:
      | width | height |
      | 1472  | 900    |
      | 1440  | 900    |
      | 1366  | 1024   |
      | 1024  | 1366   |

  # The panel anchors a thread on the whole solutions block rather than on one
  # tab — a comment can name "Solution 2" in prose, and per-solution anchors are
  # more enum than the use has earned. What this checks is that the anchor still
  # reads as itself with the strip in the section it points at.
  Scenario: A thread anchored on the solutions block names it, with the tabs present
    When the reviewer comments "Solution 3 is the one that survives a reboot." on the "solutions" of record "r-stale-lock"
    Then the "solutions" thread of record "r-stale-lock" is anchored to "#1 · Solutions · Deploy blocked on a stale lock file"
    And the "solutions" thread of record "r-stale-lock" shows "Solution 3 is the one that survives a reboot."
    And record "r-stale-lock" has one solution tab strip and no stacked solution list

  # The renderer builds React elements from its own parse and never hands a
  # string to the DOM as markup, so a tag an author typed is a tag the reader
  # sees. Both halves are asserted, and the subset is asserted over prose that
  # actually builds something — a `<b>` is outside the subset whether it came
  # from the source or from a renderer that grew an escape hatch of its own.
  Scenario: HTML in the source is text on the page, never markup
    Then the "workaround" prose of record "r-bullet-responses" is built only from the safe subset
    And the "problem" prose of record "r-bullet-responses" is built only from the safe subset
    And the "workaround" prose of record "r-bullet-responses" shows the literal text "<b>prose</b>"

  # This record's problem has held a backticked command since the fixture was
  # written, and every reader so far has been shown the backticks.
  Scenario: Inline code renders as code, where the raw backticks used to be
    Then the "problem" prose of record "r-stale-lock" shows the code "retro up"
    And no markdown syntax is visible on record "r-stale-lock"

  # A comment is prose the human just wrote, so it is read the same way. The
  # renderer is asserted where the comments now are: they left the card for
  # the side panel, so a renderer wired into the sections and not into the
  # panel would pass a whole-card sweep with asterisks on the screen.
  Scenario: A comment renders as prose, the same subset as a record
    When the reviewer comments "**Understated.** The impact is larger than this says." on the "problem" of record "r-stale-lock"
    Then the "problem" thread of record "r-stale-lock" shows "Understated. The impact is larger than this says."
    And the newest "problem" comment of record "r-stale-lock" leads with the bold text "Understated."
    And no markdown syntax is visible in the comments panel
    And no markdown syntax is visible on record "r-stale-lock"

  Scenario: The AI's proposed values are pre-filled
    Then the "severity" of record "r-stale-lock" reads "SEV2"
    And the "involvement" of record "r-stale-lock" reads "Pull request — human reviews before merge"
    # The ceiling is a property of the solution on a record that proposes some,
    # so the dial only exists on a record filed before they did.
    And the solution level of record "r-bullet-responses" is "1"

  # Two retrospectives, one label. The severity option puts the number back
  # in front: severity is the one enum addressed by number, and generalising
  # the "what — why" rule to all three buried it under a sentence. A
  # follow-up fix is the other half — that correction overshot, deleting the
  # description instead of demoting it, and one real review later a
  # compact-only select read as opaque with the scale's direction nowhere on
  # screen. So: the number leads, a short description rides behind it, and
  # SEV1 says which end is the top.
  Scenario: Severity is offered as SEV1 … SEV5, each saying what it means
    Then the severity options of record "r-stale-lock" read:
      | SEV1 — highest — halts everything |
      | SEV2 — blocks a major flow        |
      | SEV3 — degrades the work          |
      | SEV4 — minor friction             |
      | SEV5 — nice-to-have               |

  # The canonical strings of docs/design/data-model.md §Enum option labels, which
  # holds v2's wording verbatim. This scenario is what stops a label being
  # paraphrased, reordered, or quietly shortened — and what stops
  # `none`, `upstream` or `undecided` coming back as something a human can pick.
  Scenario: Every solution level is offered, in order, with its definition intact
    Then the solution level options of record "r-bullet-responses" read:
      | Level 1 — words only: guidance text; nothing executes it, nothing conforms to it                         |
      | Level 2 — tune existing: behavior change inside artifacts that already exist                             |
      | Level 3 — add surface: something new that everything existing can safely ignore                          |
      | Level 4 — change contracts: others must conform; consumers updated and old data shimmed in the same change |
      | Level 5 — open-ended: emergent, autonomous, or not cleanly undoable                                      |

  # `none`, `upstream` and `undecided` were cut from what anyone may choose,
  # and retro 1 already holds two of them. Human data is append-only: a level
  # nobody can pick any more still has to read, and still has to survive a
  # verdict that says nothing about it. `r-silent-tailer` carries `upstream`.
  Scenario: A level that was cut is not offered, and nothing pre-selects it either
    Then the solution level options of record "r-silent-tailer" read:
      | Level 1 — words only: guidance text; nothing executes it, nothing conforms to it                         |
      | Level 2 — tune existing: behavior change inside artifacts that already exist                             |
      | Level 3 — add surface: something new that everything existing can safely ignore                          |
      | Level 4 — change contracts: others must conform; consumers updated and old data shimmed in the same change |
      | Level 5 — open-ended: emergent, autonomous, or not cleanly undoable                                      |
    And no solution level is chosen on record "r-silent-tailer"

  Scenario: A verdict that says nothing about the level leaves the cut one standing
    When the reviewer approves record "r-stale-lock"
    And the reviewer declines record "r-bullet-responses"
    And the reviewer approves record "r-silent-tailer"
    And the reviewer finishes the review
    And the AI closes the review
    Then the review is finished
    And the "solution-level" of record "r-silent-tailer" reads "Upstream — file elsewhere; nothing built here"

  Scenario: Choosing one of the five replaces the cut level for good
    When the reviewer chooses solution level "3" on record "r-silent-tailer"
    And the reviewer approves record "r-silent-tailer"
    Then record "r-silent-tailer" is "approved"
    And the solution level of record "r-silent-tailer" is "3"

  # The standing rule for the enums that still explain themselves: the
  # explanatory half is never dropped for brevity, and a two-line wrap is
  # the acceptable cost. On a laptop even the longest row fits on one line,
  # so the rule can only be observed where the wrap happens. Severity is
  # exempt and has nothing left to clip.
  Scenario: No label is shortened, even on the narrow screen where it has to wrap
    When the reviewer is on an iPad in portrait
    Then no label on record "r-bullet-responses" is cut off
    And the "involvement" of record "r-stale-lock" reads "Pull request — human reviews before merge"
    # The level label moved onto the solutions on a record that proposes some,
    # and the rule moved with it.
    And no solution level label on record "r-stale-lock" is cut off

  Scenario: Nothing is decided until the human decides it
    Then record "r-stale-lock" is "pending"
    And record "r-bullet-responses" is "pending"
    And record "r-silent-tailer" is "pending"
    And the filter counts read:
      | pending | 3 |

  Scenario: Approving a record is an explicit act, and the count follows it
    When the reviewer approves record "r-stale-lock"
    Then record "r-stale-lock" is "approved"
    And the filter counts read:
      | pending | 2 |

  Scenario: Declining is a state, not a deletion
    When the reviewer declines record "r-bullet-responses"
    Then record "r-bullet-responses" is "declined"
    And record "r-bullet-responses" shows "Answers come back as bullet lists when prose was asked for"
    And the filter counts read:
      | pending | 2 |

  # Hold left the verdict row and became a control and a tag of its own; it
  # was removed once it shipped, because there was no way to tell whether a
  # record was on hold before or after the hold control was clicked. The
  # same outcome is reachable by selecting something to be done only with
  # the human in the loop.
  #
  # So the card carries a verdict and its three values, and nothing beside them.
  # The two scenarios below are that absence: what a card offers, and what a card
  # shows, each counted rather than checked one control at a time.

  Scenario: Hold is not one of the verdicts on offer
    Then record "r-silent-tailer" offers the verdicts "Approve, Decline, Revise"

  Scenario: A record offers a verdict and its values, and nothing that parks it
    Then record "r-silent-tailer" offers nothing that parks it

  Scenario: A record wears its verdict and no second status beside it
    When the reviewer approves record "r-silent-tailer"
    Then record "r-silent-tailer" is "approved"
    And record "r-silent-tailer" wears no status but its verdict and who asked for it

  # An agent takes a record off the queue in its own process, and the
  # review page says so while the reviewer is reading it — the claim lands on the
  # event stream and the card re-reads records.list, with no reload anywhere.
  #
  # The second half is the one that would actually have failed in the field: a
  # badge that went up and never came down would have the reviewer believing
  # somebody is still on a record that has been fixed. Resolving gives the record
  # back in the same unit of work (core's set-record-lifecycle), so the mark goes
  # with it — and the scenario reads both edges on one record, because a page that
  # only ever put the badge up would pass a test that only looked once.
  Scenario: A record the AI has picked up says so, and stops saying so once it is resolved
    Given the AI claims record "r-stale-lock" of retro 1
    Then record "r-stale-lock" is marked "in progress"
    When the AI resolves record "r-stale-lock" of retro 1, citing "abc123"
    Then record "r-stale-lock" is not marked "in progress"
    And the browser reported no console errors

  # The one deliberate exception to read-only-after-finish went with the feature:
  # a finished review now takes nothing at all. The card that was the exception
  # is the card asserted shut.
  Scenario: A finished review offers nothing to write, not even on the card that used to
    When the reviewer approves record "r-stale-lock"
    And the reviewer declines record "r-bullet-responses"
    And the reviewer approves record "r-silent-tailer"
    And the reviewer finishes the review
    And the AI closes the review
    Then the review is finished
    And record "r-silent-tailer" offers no decision buttons
    And record "r-silent-tailer" offers nothing that parks it
    And no record offers a way to comment

  Scenario: Editing the values and the note decides nothing on its own
    When the reviewer sets the "severity" of record "r-stale-lock" to "1"
    And the reviewer writes the note "Do this one first." on record "r-stale-lock"
    Then record "r-stale-lock" is "pending"
    And the filter counts read:
      | pending | 3 |

  Scenario: The verdict records the values that were on screen when it was pressed
    When the reviewer sets the "severity" of record "r-bullet-responses" to "1"
    And the reviewer chooses solution level "4" on record "r-bullet-responses"
    And the reviewer sets the "involvement" of record "r-bullet-responses" to "autonomous"
    And the reviewer writes the note "Do this one first." on record "r-bullet-responses"
    And the reviewer approves record "r-bullet-responses"
    Then record "r-bullet-responses" is "approved"
    And the "severity" of record "r-bullet-responses" reads "SEV1"
    And the solution level of record "r-bullet-responses" is "4"
    And the "involvement" of record "r-bullet-responses" reads "No involvement — fully autonomous"
    And the note on record "r-bullet-responses" reads "Do this one first."

  Scenario: A verdict can be changed, and the newest one is what shows
    When the reviewer declines record "r-silent-tailer"
    And the reviewer approves record "r-silent-tailer"
    Then record "r-silent-tailer" is "approved"
    And the filter counts read:
      | pending | 2 |

  # Two verdicts could not say "redo this one": a third answer used to ride
  # in comments, a mis-click had no way back, and a decided button looked
  # much like an undecided one. Approving, declining or requesting a
  # revision each moves a record out of pending, and pressing the same
  # verdict again undoes it — with a clear indication of what is already
  # selected.

  Scenario: Asking for a revision decides the record, like the other two verdicts
    When the reviewer asks for a revision of record "r-bullet-responses"
    Then record "r-bullet-responses" is "revise"
    And the filter counts read:
      | pending | 2 |

  Scenario: Pressing the verdict that is already chosen puts the record back to pending
    When the reviewer approves record "r-stale-lock"
    Then record "r-stale-lock" is "approved"
    When the reviewer presses the chosen verdict of record "r-stale-lock" again
    Then record "r-stale-lock" is "pending"
    And no verdict is chosen on record "r-stale-lock"
    And the filter counts read:
      | pending | 3 |

  # The undo is an append, not an erasure: the verdict that was undone is still
  # in the record's history, which is the only place it could be after the page
  # has moved on. Asserted through the page, on the count it changed.
  Scenario: Undoing and deciding again lands where the last press says
    When the reviewer asks for a revision of record "r-silent-tailer"
    And the reviewer presses the chosen verdict of record "r-silent-tailer" again
    And the reviewer declines record "r-silent-tailer"
    Then record "r-silent-tailer" is "declined"
    And the chosen verdict on record "r-silent-tailer" is "declined"

  # The half a screenshot has to show: which button was pressed. The claim is
  # not that a class name is on it — it is that a reader can tell the chosen one
  # from the two beside it, so the fill, the ink, the border and the weight are
  # read off the rendered page and compared. Run as a control with the selected
  # styling deleted, per testing.md §Operational rules.
  #
  # **Both themes, and with the pointer on it**, because the first version of
  # this shipped green while failing in exactly those places: the Button's
  # outline variant carries `dark:` and `hover:` overrides that tailwind-merge
  # cannot drop (a different modifier is not a conflict), so under `.dark` the
  # fill and the border were suppressed and hovering took the ink as well —
  # leaving font weight alone to say what was chosen. A scenario that only ever
  # looked at an unhovered light-mode page could not see any of it.
  Scenario Outline: The chosen verdict is unmistakable beside the ones not chosen, in the <theme> theme
    Given the reviewer has set dark mode to "<theme>"
    When the reviewer asks for a revision of record "r-stale-lock"
    Then the chosen verdict on record "r-stale-lock" is "revise"
    And the chosen verdict on record "r-stale-lock" stands out from the ones beside it
    And the chosen verdict on record "r-stale-lock" still stands out with the pointer on it

    Examples:
      | theme |
      | light |
      | dark  |

  # Comments used to be rendered under the section they answered. They moved
  # into the side panel so a human can see all comments in one place.
  # Reading a review meant scrolling the whole page to find out what had
  # been said on it, and the seven comment surfaces a single record could
  # show were seven places to look.
  #
  # So a record's threads are in the panel with every other comment, and each one
  # says where it hangs — the record's number, the section's display title and
  # the record's title, one click from that record.

  Scenario: Every comment on the retrospective is in the one panel
    Then the comments panel holds 2 threads, 1 of them on a record
    And the "direction" thread of record "r-bullet-responses" shows "Complete sentences, but keep dropping detail"
    And the comments panel shows "Three records this round is fewer than the session earned."

  # The header used to spend two
  # fixed lines saying the wrong things first: the record's number alone on one,
  # the title and only then the section on the other — so what the thread is
  # *about* arrived last, in the one block a reader scans to find one
  # conversation. The order is now the number, then a separator, then the
  # section, then a separator, then the title. The title can flow into a
  # second line, and is only cut off if it would overflow that second line.
  #
  # The claim is the whole line rather than its three parts, because a number, a
  # section and a title all present in some arrangement is exactly what the
  # header did before it was reorganised.
  Scenario: A record's comment says which record and which section it is on
    Then the "direction" thread of record "r-bullet-responses" is anchored to "#2 · Agreed direction · Answers come back as bullet lists when prose was asked for"

  # The second half of the rule, and it is a ceiling rather than a
  # height: a header runs into a second line when it needs one, and is cut at the
  # end of that line only when it would need a third. Both halves are measured
  # here, because either alone passes on a header that is always two lines and on
  # one that is always cut.
  #
  # In both themes: the leading and the font that decide where the cut falls are
  # tokens, and a token a theme overrides would move the cut in one theme and not
  # the other.
  #
  # It reads the phone's sheet (326px), and the
  # move is the ceiling being asserted where it can still be reached: the comments
  # rail went 288 -> 368, and at 368 this fixture's longest header fits its two
  # lines with room to spare, so the scenario went green on a page that had
  # stopped cutting anything. The narrowest panel the product has is where a cut
  # can still be observed, and a ceiling nothing reaches is a ceiling no scenario
  # can see.
  Scenario Outline: A thread header takes a second line, and is cut only when it would need a third, in the <theme> theme
    Given the reviewer's screen is 390 by 844
    And the reviewer opens retro 1
    And the reviewer has set dark mode to "<theme>"
    When the reviewer comments "Which stage does it open?" on the "problem" of record "r-stale-lock"
    Then the "direction" thread header of record "r-bullet-responses" runs 2 lines
    And the "direction" thread header of record "r-bullet-responses" is cut off
    And the "problem" thread header of record "r-stale-lock" runs 2 lines
    And the "problem" thread header of record "r-stale-lock" keeps every character

    Examples:
      | theme |
      | light |
      | dark  |

  # And a header that fits takes one line, which is what stops the budget being a
  # two-line block with a title in it. The width is what varies rather than the
  # title: in the phone's 326px sheet even this fixture's shortest header needs
  # two lines, and on the portrait iPad the panel is a 768px sheet, where the same
  # header fits once over.
  Scenario: A header that fits takes one line and keeps every character
    Given the reviewer's screen is 1024 by 1366
    And the reviewer opens retro 1
    When the reviewer opens the review comments
    Then the "direction" thread header of record "r-bullet-responses" runs 1 line
    And the "direction" thread header of record "r-bullet-responses" keeps every character
    And the browser reported no console errors

  # The way back. It is the record rail's own landing (`filter.jumpTo`), not a
  # second one: two implementations of "put the reviewer down on that record" are
  # two places a reviewer can end up.
  Scenario: A record's comment is one click back to the record it is about
    When the reviewer jumps to the record from the "direction" thread of record "r-bullet-responses"
    Then the viewport lands on record "r-bullet-responses"

  # The record body keeps one thing about comments: the way to start one. The
  # sweep is counted rather than named — it
  # reads every hook a card rendered and fails on anything thread-shaped, whatever
  # it ends up called — and it asserts the panel is holding threads in the same
  # breath, so "no threads in the body" cannot be satisfied by there being no
  # threads at all.
  Scenario: No record body renders a comment thread any more
    Then no record body holds a comment thread

  # Threads are one level nested and only show top level
  # comments, with a reply count and a click to view the replies. A column
  # of threads is for seeing how many conversations are open; a wall of
  # every message in each of them is the reading column's problem moved
  # sideways.
  Scenario: A thread shows its opening message and keeps its replies behind a count
    Then the "direction" thread of record "r-bullet-responses" shows one message and "1 reply"
    And the "direction" thread of record "r-bullet-responses" shows "Complete sentences, but keep dropping detail"

  Scenario: The replies open one level in, and close again
    When the reviewer opens the replies in the "direction" thread of record "r-bullet-responses"
    Then the "direction" thread of record "r-bullet-responses" shows 2 messages, the replies nested
    And the "direction" thread of record "r-bullet-responses" shows "Understood: prose, same budget, fewer things said."
    When the reviewer closes the replies in the "direction" thread of record "r-bullet-responses"
    Then the "direction" thread of record "r-bullet-responses" shows one message and "1 reply"

  # Zero replies is not a "0 replies" affordance: it is a comment nobody has
  # answered yet, and a control that opens onto nothing is chrome.
  Scenario: A comment nobody has answered offers nothing to open
    When the reviewer comments "Two of these records are the same complaint." on the review
    Then the review thread offers no reply count

  # Comments show the revision number they are associated with, but the
  # comments show across all revisions regardless. Both halves are here —
  # every message says which revision it belongs to, and the panel never
  # filters by the one on screen. The fixture's comments were written
  # against revision 1 and the page is showing revision 2, so a page that
  # stamped everything with what it is displaying would fail rather than
  # pass by accident.
  Scenario: Every comment says which revision it was written against, across all of them
    When the reviewer comments "This one is the same complaint as #1." on the review
    # The three openers on screen, in panel order: the record's thread, the
    # review's, and the one just written. The replies stay behind their counts,
    # and the thread that crosses a revision boundary is the scenario below.
    Then the comments say which revisions they were written against:
      | rev 1 |
      | rev 1 |
      | rev 2 |

  Scenario: A thread that ran across two revisions reads as one conversation
    When the reviewer replies "Agreed — that is the trade." in the "direction" thread of record "r-bullet-responses"
    And the reviewer opens the replies in the "direction" thread of record "r-bullet-responses"
    Then the "direction" thread of record "r-bullet-responses" carries revisions "rev 1, rev 1, rev 2"

  # The whole of what the aimed composer put on the wire: the text, the record
  # and section it was filed under, and the revision it was written against —
  # revision 2, the one on screen, where the fixture's comments are on revision 1.
  Scenario: The reviewer opens a thread on a section
    When the reviewer comments "The impact is understated." on the "problem" of record "r-stale-lock"
    Then the "problem" thread of record "r-stale-lock" shows "The impact is understated."
    And the "problem" thread of record "r-stale-lock" is anchored to "#1 · Problem · Deploy blocked on a stale lock file"
    And the "problem" thread of record "r-stale-lock" carries revisions "rev 2"

  Scenario: The reviewer replies in a thread that already exists
    When the reviewer replies "Agreed — that is the trade." in the "direction" thread of record "r-bullet-responses"
    And the reviewer opens the replies in the "direction" thread of record "r-bullet-responses"
    Then the "direction" thread of record "r-bullet-responses" shows "Agreed — that is the trade."

  # The two surfaces in one act: the click is on the card, the typing is in the
  # panel, and the chip between them is what says the two are talking about the
  # same thing. Without it the composer is ambiguous in exactly the way this
  # change is meant to remove — the panel is full of other threads and nothing
  # says the box has been aimed somewhere.
  Scenario: Pressing Comment on a section aims the panel's composer at it
    When the reviewer starts a comment on the "root_cause" of record "r-silent-tailer"
    Then the composer is aimed at "#3 · Root cause · The tailer stops without saying so"
    And the keyboard is in the panel composer

  Scenario: The aim can be taken back, and the comment goes to the review instead
    When the reviewer starts a comment on the "root_cause" of record "r-silent-tailer"
    And the reviewer takes the aim off the composer
    Then the composer is aimed at the review
    When the reviewer comments "Two of these records are the same complaint." on the review
    Then the comments panel shows "Two of these records are the same complaint."
    And the comments panel holds 3 threads, 1 of them on a record

  # The aim does not stick. A composer that stayed pointed at whichever section
  # was last clicked is how a thought about the round ends up filed under a record.
  Scenario: The aim clears itself once the comment lands
    When the reviewer comments "The impact is understated." on the "problem" of record "r-stale-lock"
    Then the composer is aimed at the review

  # The comment buttons used to show at the bottom of the section; each one
  # now sits next to the section it is for. Every section heading carries a
  # small comment glyph inline beside the heading text.
  #
  # The affordance rendered after the section's content — after the problem
  # bullets, after the human-words block — so on a large section it was
  # a screen below the heading that named it and read as belonging to whatever
  # came last. Two ways for that to be wrong and both are asserted: it has to be
  # beside the heading, and it has to have left the bottom.
  Scenario: A section's comment glyph sits beside its heading, not under its body
    Then the comment glyph of the "problem" of record "r-stale-lock" sits inline after the heading
    And the comment glyph of the "problem" of record "r-stale-lock" is above the section body
    And the comment glyph of the "human_words" of record "r-stale-lock" sits inline after the heading
    And the comment glyph of the "human_words" of record "r-stale-lock" is above the section body

  # It is the same control it always was — the move is where it sits, not what it
  # does — so the act it performs is asserted through it end to end rather than
  # trusted to look unchanged.
  Scenario: The glyph beside the heading opens the same section thread the button did
    When the reviewer comments "The impact is understated." on the "problem" of record "r-stale-lock"
    Then the "problem" thread of record "r-stale-lock" shows "The impact is understated."
    And the "problem" thread of record "r-stale-lock" is anchored to "#1 · Problem · Deploy blocked on a stale lock file"

  # A record's title can also carry a comment. `title` has been a
  # first-class comment section in the model, in the CLI and in the section table
  # all along; the header was styled as identity rather than as a section, so the
  # one section that names the record was the one section the page offered no way
  # to discuss.
  #
  # The placement is deliberate: the comment glyph sits inline with the
  # title, right next to its last word, rather than separated off to the
  # right. That is measured rather than eyeballed — a floated-right glyph
  # satisfies every visibility check ever written and is exactly the shape
  # that was ruled out.
  Scenario: A record's title carries the same glyph, right after its last word
    Then the comment glyph on the title of record "r-stale-lock" sits after the title's last word
    And every comment glyph on record "r-stale-lock" says what it is for

  # The thread it opens is the one that already existed: no new thread kind, no
  # model change, and the panel anchors it "#id · Title · <record title>" like any
  # other section thread.
  Scenario: A title thread opens from the header and lands in the panel like any other
    When the reviewer starts a comment on the "title" of record "r-stale-lock"
    Then the composer is aimed at "#1 · Title · Deploy blocked on a stale lock file"
    When the reviewer writes "The title says the symptom, not the cause." in the panel composer
    Then the "title" thread of record "r-stale-lock" shows "The title says the symptom, not the cause."
    And the "title" thread of record "r-stale-lock" is anchored to "#1 · Title · Deploy blocked on a stale lock file"

  # A human-only resolved flag per comment (or per thread), visible state on
  # the review page, and the AI forbidden at the schema level like every
  # human field — only the user can mark comments as resolved, and resolved
  # comments appear collapsed.
  Scenario: The human settles a thread, and it collapses to one line
    When the reviewer resolves the "direction" thread of record "r-bullet-responses"
    Then the "direction" thread of record "r-bullet-responses" is settled and collapsed
    And the comments panel holds 2 threads, 1 of them on a record

  Scenario: A settled thread opens again, and reopening it is another act
    When the reviewer resolves the "direction" thread of record "r-bullet-responses"
    And the reviewer opens the settled "direction" thread of record "r-bullet-responses"
    Then the "direction" thread of record "r-bullet-responses" is settled, readable, and offers only Reopen
    When the reviewer reopens the "direction" thread of record "r-bullet-responses"
    Then the "direction" thread of record "r-bullet-responses" is open again

  # The visible half, in both themes and channel by channel (testing.md
  # §Operational rules): a settled thread fades *and* its ink goes muted, and an
  # assertion that accepted either alone would accept the state where a dark-mode
  # override collapsed one of them — which is how a selected-verdict styling
  # shipped green before.
  Scenario Outline: A settled thread reads as settled beside the ones still open, in the <theme> theme
    Given the reviewer has set dark mode to "<theme>"
    When the reviewer resolves the "direction" thread of record "r-bullet-responses"
    Then the "direction" thread of record "r-bullet-responses" is settled and collapsed
    And the settled thread reads as settled beside the ones still open

    Examples:
      | theme |
      | light |
      | dark  |

  # There used to be no way to raise something about the review itself,
  # mid-review — every comment box on the page hung off one section of one
  # record. So asks about the review as a whole went through a record's
  # thread instead, where a review-level reading cannot see them — the
  # record they were smuggled under was not what any of them was about.
  #
  # The domain has carried review-level threads since the first schema
  # (data-model.md §Comment threads). Nothing on the page had ever reached them.

  Scenario: The reviewer opens a thread on the review itself, not on a record
    When the reviewer comments "Two of these records are the same complaint." on the review
    Then the comments panel shows "Two of these records are the same complaint."

  # The other half of a thread: the AI answers from its own process, and the
  # answer reaches a page nobody reloaded (realtime.md). A review-level thread is
  # not on any record, so the record queries these events already invalidate
  # cannot carry it — this is what proves the review's own query is refetched.
  Scenario: The AI's answer in a review thread reaches the page it was asked on
    When the reviewer comments "Two of these records are the same complaint." on the review
    And the AI replies "Merged them in the next revision." in the review thread
    # It arrives as a reply, so it arrives behind the count the panel keeps them
    # behind — the point of the scenario is that it arrived at all, and the open
    # is what proves the query refetched rather than the count merely ticking.
    And the reviewer opens the replies in the review thread
    Then the comments panel shows "Merged them in the next revision."

  # A requests panel shipped beside the review's comment threads and was
  # removed the first time it was seen live: comments at the review level
  # cover the same need, with one individual request addressable per
  # comment.
  #
  # So the page carries one review-level surface and not two. This scenario is
  # the absence, asserted where a returning panel would be seen: the review's own
  # area, on a review that has everything else it can have.
  Scenario: The review offers one place to raise something, and it is the comment thread
    Then the review shows a comment panel and no requests panel
    And the review offers nothing that asks for something outside a comment

  # A finished review is terminal, and the server refuses a comment on one.
  # The page has to agree with it rather than offer a control whose only outcome
  # is an error.
  Scenario: A finished review takes no more comments
    When the reviewer approves record "r-stale-lock"
    And the reviewer declines record "r-bullet-responses"
    And the reviewer approves record "r-silent-tailer"
    And the reviewer finishes the review
    And the AI closes the review
    Then the review is finished
    And the review takes no more comments
    And no record offers a way to comment
    And the review still shows the comments it already had

  # The pair to the scenario above, and the state that matters most in practice:
  # **a retrospective nobody commented on**, which every one of them is until
  # somebody writes the first comment. A read-only review has no control the
  # panel could offer, so with nothing to read it is a bordered box with a
  # heading in it — chrome that would sit in the way on every closed review a
  # reviewer revisits. What a review *does* carry still shows: that is the scenario above,
  # and the two together are the whole rule.
  Scenario: A finished review with no comments at all shows no comment panel
    Given the review has no comments at all
    And the reviewer opens retro 1
    When the reviewer approves record "r-stale-lock"
    And the reviewer declines record "r-bullet-responses"
    And the reviewer approves record "r-silent-tailer"
    And the reviewer finishes the review
    And the AI closes the review
    Then the review is finished
    And the review shows no comment panel and no requests panel

  # The review's comments used to ship as a full-width panel above the first
  # record. That placement cost a full scroll to the top to add a comment
  # and then a scroll back down to find the place again — nine of those
  # round trips in one round — and on the iPad the panel cost the fold
  # whether it was used or not.
  #
  # The fix moves comments to the side, or behind a flyout. So the comments
  # left the reading column — for a rail beside it where there is room for a
  # third column, and for a sheet behind one glyph in the sticky header
  # where there is not.

  Scenario: The review's comments stand beside the reading column, open to type into
    Given the reviewer's screen is 1536 by 960
    And the reviewer opens retro 1
    Then the comment rail is on screen
    And the review comments sit beside the records rather than above them
    And the reading column keeps its measure
    And the review offers its composer with nothing to press first
    And the comments panel shows "Three records this round is fewer than the session earned."

  # The page takes its `wide` measure to seat a third column, and hands the room
  # to the reading column the moment there is no third column to seat: `flex-1`
  # takes whatever it is given. A measurement once found 992px of prose here
  # against the 736px the page has always given it, on a review with nothing
  # to read and nothing to write — **a retrospective nobody commented on**,
  # which is every closed review a reviewer revisits before anyone wrote on
  # it.
  #
  # It was fixed once by narrowing the *page* whenever the rail was absent, which
  # made the page's width a function of a query's answer and left the dashboard
  # narrower than the review, its width not matching the retro page's. The cap
  # is on the reading column now, so both
  # things below are true at once and at both widths that have three columns: the
  # measure holds with the rail and without it, and the column starts in the same
  # place either way — a rail arriving no longer shoves the prose sideways.
  Scenario Outline: A closed review with no comments at all keeps the reading measure, and the column's place
    Given the review has no comments at all
    And the reviewer's screen is <width> by <height>
    And the reviewer opens retro 1 pinned to revision 1
    Then the review is read-only
    And the comment rail is not on screen
    And the reading column keeps its measure
    And the reading column starts <left> pixels from the left
    And the page does not scroll sideways

    # 24 + 288 + 32 = 344 wherever the page is not centred, and 192 more at 1920
    # where the measure has stopped at 1536 and the rest is margin.
    Examples:
      | width | height | left |
      | 1920  | 1080   | 536  |
      | 1536  | 960    | 344  |

  # The other half, so the rule is not "narrow whenever it is read-only": a
  # closed review that does carry a thread still has the rail — and the same
  # measure and the same column as the one above, which is the claim that the
  # rail's arrival costs the reading column nothing.
  #
  # 1472 is the breakpoint itself, where three columns first fit: the reading
  # column is 704px there, the narrowest the band allows, and it is the row that
  # says the geometry closes at the width that admits it rather than later.
  Scenario Outline: A closed review that does carry a comment keeps its rail, and the same column beside it
    Given the reviewer's screen is <width> by <height>
    And the reviewer opens retro 1 pinned to revision 1
    Then the review is read-only
    And the comment rail is on screen
    And the reading column keeps its measure
    And the reading column starts <left> pixels from the left
    And the three columns close flush at the cap
    And the review takes no more comments

    Examples:
      | width | height | left |
      | 1920  | 1080   | 536  |
      | 1536  | 960    | 344  |
      | 1472  | 900    | 344  |

  # The record itself, on the laptop: the reviewer is deep in the list,
  # types a comment, and is still where they were. Both halves are asserted
  # — the comment landed *and* the page did not move — because either alone
  # is half the complaint.
  Scenario: A comment written from the rail costs the reviewer nothing of their place
    Given the reviewer's screen is 1536 by 960
    And the reviewer opens retro 1
    When the reviewer scrolls to record "r-silent-tailer"
    And the reviewer comments "This one is the same complaint as #1." on the review
    Then the comments panel shows "This one is the same complaint as #1."
    And the reviewer is still on record "r-silent-tailer"

  # ux-brief 04's three screens. The rail needs a third column and the portrait
  # iPad has room for two, so below xl the comments are behind one glyph in the
  # header instead — and the glyph is never on a page that already shows the
  # rail, because two ways into the same threads is one too many.
  Scenario Outline: The comments have a rail where there is room for one, and the header where there is not
    Given the reviewer's screen is <width> by <height>
    And the reviewer opens retro 1
    Then the comment rail <rail>
    And the review comments affordance <affordance>
    And the page does not scroll sideways
    And the browser reported no console errors

    Examples:
      | width | height | rail             | affordance     |
      | 1920  | 1080   | is on screen     | is not offered |
      | 1536  | 960    | is on screen     | is not offered |
      | 1440  | 900    | is not on screen | is offered     |
      | 1366  | 1024   | is not on screen | is offered     |
      | 1024  | 1366   | is not on screen | is offered     |

  # The portrait iPad, which is what this scenario is about. The sheet opens
  # over the page rather than in it, so the reading column never reflows:
  # the record the reviewer was on is still exactly where it was left while
  # the sheet is open, after posting, and once it is closed again.
  Scenario: On the portrait iPad the comments open over the page and give the place back
    Given the reviewer's screen is 1024 by 1366
    And the reviewer opens retro 1
    When the reviewer scrolls to record "r-silent-tailer"
    And the reviewer opens the review comments
    Then the review comments are open
    And the reviewer is still on record "r-silent-tailer"
    When the reviewer comments "This one is the same complaint as #1." on the review
    Then the comments panel shows "This one is the same complaint as #1."
    And the reviewer is still on record "r-silent-tailer"
    When the reviewer presses the Escape key
    Then the review comments are closed
    And the reviewer is still on record "r-silent-tailer"

  # The sheet is the narrow layout's surface, so crossing into the rail's width
  # takes it off the page — and it must not be waiting there on the way back. A
  # screen that widened past the breakpoint and narrowed again would otherwise
  # come home to a sheet nobody tapped, which reads as the page acting on its own.
  #
  # It used to be written as an iPad turned to landscape and back, and it cannot
  # be any more: with the breakpoint at 92rem, both of
  # that device's orientations are on the narrow side and the rotation crosses
  # nothing. The behaviour is unchanged and still has to hold, so the scenario
  # crosses the breakpoint the only way that is left.
  Scenario: The sheet does not come back by itself once the page has crossed the breakpoint and back
    Given the reviewer's screen is 1024 by 1366
    And the reviewer opens retro 1
    When the reviewer opens the review comments
    And the reviewer turns the iPad to 1536 by 960
    Then the comment rail is on screen
    And the review comments are closed
    When the reviewer turns the iPad to 1024 by 1366
    Then the review comments affordance is offered
    And the review comments are closed

  Scenario: The backdrop closes the comments too
    Given the reviewer's screen is 1024 by 1366
    And the reviewer opens retro 1
    When the reviewer opens the review comments
    And the reviewer clicks outside the review comments
    Then the review comments are closed

  # On iPad the comments panel gets wider for more room, without taking too
  # much of the screen. It was 22rem while the sheet held the review's own
  # threads, and 26rem once it held every comment on the retrospective. The
  # flyouts got wider again for more room on iPad, and the sheet now takes
  # 48rem, which on this screen is 768 of its 1024 pixels.
  Scenario: The comments sheet is wider now that it holds every comment
    Given the reviewer's screen is 1024 by 1366
    And the reviewer opens retro 1
    When the reviewer opens the review comments
    Then the comments sheet is 768 pixels wide
    And the comments panel holds 2 threads, 1 of them on a record
    And the page does not scroll sideways
    And the browser reported no console errors

  # The reveal rule: a flyout leaves X pixels of the page uncovered, and the
  # rest is covered. X is 64px and it is a *constant* — the 85vw it
  # replaces was a proportion, which is the same thing said in a way that
  # gets it wrong at both ends: 59px of strip on the phone, where a thumb
  # has to find it, and 125px on the iPad, where it is width the comments
  # could have had.
  #
  # Two screens, because a fixed reveal and a capped width are one rule with two
  # halves and each screen shows one of them. On the phone neither cap is reached
  # and both sheets are 326px — the reveal is what decides, and 326 is close
  # to the 332 the comments already had — just enough on the phone. On the
  # portrait iPad both caps have taken over, the comments sheet has stopped at
  # 768 and the index at 416, and the strip is no longer the thing being asserted
  # so much as the floor under it — never less than 64, and here more.
  #
  # The strip is measured as the gap the sheet leaves against the far edge of the
  # screen, so it is the page you can still see rather than a subtraction that
  # would pass on a sheet floating in the middle of the viewport.
  Scenario Outline: A flyout covers the page but for a fixed strip, at <width> by <height>
    Given the reviewer's screen is <width> by <height>
    And the reviewer opens retro 1
    When the reviewer opens the review comments
    Then the comments sheet is <comments> pixels wide
    And the comments sheet leaves <comments strip> pixels of the page uncovered
    When the reviewer clicks outside the review comments
    And the reviewer opens the record index
    Then the record index sheet is <index> pixels wide
    And the record index sheet leaves <index strip> pixels of the page uncovered
    And the page does not scroll sideways
    And the browser reported no console errors

    Examples:
      | width | height | comments | comments strip | index | index strip |
      | 390   | 844    | 326      | 64             | 326   | 64          |
      | 834   | 1112   | 768      | 66             | 416   | 418         |

  # On the portrait iPad sheet, an empty review used to mount the composer
  # at the top; the moment the first comment posted, the thread list took
  # the flex space and the composer landed pinned at the bottom — the
  # control the user was mid-interaction with moved across the whole sheet.
  # The fix anchors it at the bottom in the empty state too, so the first
  # post changes nothing about where the box sits. Both halves are
  # asserted, because the second one alone was always true.
  Scenario: The composer is anchored at the bottom before there is anything above it
    Given the review has no comments at all
    And the reviewer's screen is 1024 by 1366
    And the reviewer opens retro 1
    When the reviewer opens the review comments
    Then the composer sits at the bottom of the panel
    When the reviewer comments "Two of these records are the same complaint." on the review
    Then the comments panel shows "Two of these records are the same complaint."
    And the composer sits at the bottom of the panel

  # With the threads behind a glyph, the count is what stops an unanswered
  # comment on the review being silent — the failure this page can least afford.
  Scenario: The affordance carries the count, and the count follows the threads
    Given the reviewer's screen is 1024 by 1366
    And the reviewer opens retro 1
    # Two: the record's thread and the review's. The panel is the one comments
    # surface since it replaced the inline panels, so the badge counts across
    # the records rather than the review's own threads only.
    Then the review comments affordance counts "2"
    And the review comments affordance is named "2 unresolved comments on this review"
    When the reviewer opens the review comments
    And the reviewer comments "This one is the same complaint as #1." on the review
    Then the review comments affordance counts "3"

  # The badge counts unresolved threads only. It reaches zero once
  # everything is settled, which is the moment the affordance stops needing
  # attention — the count is a to-do number rather than an archive size.
  #
  # Every move is made through the page, and the count is read after each one, so
  # this is the number following the threads in both directions rather than one
  # snapshot that happened to agree.
  Scenario: The count is what is still unresolved, and settling everything takes it to zero
    Given the reviewer's screen is 1024 by 1366
    And the reviewer opens retro 1
    Then the review comments affordance counts "2"
    When the reviewer opens the review comments
    And the reviewer resolves the "direction" thread of record "r-bullet-responses"
    Then the review comments affordance counts "1"
    And the review comments affordance is named "1 unresolved comment on this review"
    When the reviewer resolves the review thread
    Then the review comments affordance counts "nothing"
    And the review comments affordance is named "No unresolved comments on this review"
    # And nothing was hidden: both threads are still in the sheet, which is where
    # the total stays one tap away.
    And the comments panel holds 2 threads, 1 of them on a record
    When the reviewer opens the settled "direction" thread of record "r-bullet-responses"
    And the reviewer reopens the "direction" thread of record "r-bullet-responses"
    Then the review comments affordance counts "1"

  # The badge counts what is unsettled; whether the panel mounts at all is a
  # different question and has to stay one. A closed review whose threads are all
  # settled has its history to show, and a predicate that had followed the badge
  # would have taken the way in away with the last resolve.
  Scenario: A closed review whose threads are all settled still offers them
    Given the reviewer's screen is 1024 by 1366
    And the reviewer opens retro 1
    When the reviewer opens the review comments
    And the reviewer resolves the "direction" thread of record "r-bullet-responses"
    And the reviewer resolves the review thread
    And the reviewer presses the Escape key
    And the reviewer approves record "r-stale-lock"
    And the reviewer declines record "r-bullet-responses"
    And the reviewer approves record "r-silent-tailer"
    And the reviewer finishes the review
    And the AI closes the review
    Then the review is finished
    And the review comments affordance is offered
    And the review comments affordance counts "nothing"
    When the reviewer opens the review comments
    Then the comments panel holds 2 threads, 1 of them on a record

  # A review with nothing on it yet is the common case and it is not an empty
  # state: the composer behind the glyph is the affordance, so there is something
  # to open and nothing to count.
  Scenario: A review with no comments yet still offers the way to write one
    Given the review has no comments at all
    And the reviewer's screen is 1024 by 1366
    And the reviewer opens retro 1
    Then the review comments affordance counts "nothing"
    When the reviewer opens the review comments
    Then the review offers its composer with nothing to press first

  # The pair to "a finished review with no comments at all shows no comment
  # panel", asserted on the width where the surface is a glyph rather than a
  # rail: with nothing to read and nothing to write, there is no way in either.
  Scenario: A finished review with no comments at all offers no way in at all
    Given the review has no comments at all
    And the reviewer's screen is 1024 by 1366
    And the reviewer opens retro 1
    When the reviewer approves record "r-stale-lock"
    And the reviewer declines record "r-bullet-responses"
    And the reviewer approves record "r-silent-tailer"
    And the reviewer finishes the review
    And the AI closes the review
    Then the review is finished
    And the review comments affordance is not offered
    And the comment rail is not on screen

  # Two asks in one breath, and they are one bar: the filter chips (pending,
  # approved, declined etc) used to scroll away and needed to stick to the
  # top instead; and the box at the bottom reading "X of Y pending - Review
  # finished ..." needed to go, replaced with a button next to the filters
  # (filters on the left, finish button on the right). Once a review is
  # finished, the button is replaced with an icon and text that indicates
  # the retro has been submitted.
  #
  # So the filter bar became the decision bar: it holds the two things
  # named above and nothing else, it stops under the header instead of
  # leaving with the first record, and the pending count went with the box
  # — the pending chip on the same bar was already saying it.

  Scenario Outline: The filters and the one action stay under the header, however far down the review goes
    Given the reviewer's screen is <width> by <height>
    And the reviewer opens retro 1
    When the reviewer scrolls to record "r-silent-tailer"
    Then the decision bar is stuck under the header
    And the filter offers the chips "pending, approved, declined, revise"
    And the review actions offer the buttons "Finish review"
    And the page does not scroll sideways
    And the browser reported no console errors

    Examples:
      | width | height |
      | 1440  | 900    |
      | 1366  | 1024   |
      | 1024  | 1366   |

  # The bar's action is one of three things and never two of them: the act, the
  # mark that says the round has gone to the AI, and the mark that says the retro
  # was submitted. Walked in order in one scenario, because what matters is that
  # each state replaces the last rather than joining it.
  Scenario: The bar's action goes from the act, to sent, to submitted
    Then the decision bar holds the filters and one action, and nothing else
    And the review actions offer the buttons "Finish review"
    When the reviewer approves record "r-stale-lock"
    And the reviewer declines record "r-bullet-responses"
    And the reviewer approves record "r-silent-tailer"
    And the reviewer finishes the review
    Then the reviewer is told the round is with the AI
    And finishing is no longer offered
    When the AI closes the review
    Then the review is finished
    And finishing is no longer on the bar
    And the decision bar holds the filters and one action, and nothing else

  # Once a review is finished, the button is replaced with an icon and text
  # that indicates that the retro has been submitted. Both halves of that are
  # asserted on their own — a mark that is only an icon is a mark half the room
  # cannot read, and a mark that is only a word is the sentence the box used to
  # carry — and both are asserted in each theme, because the ink they are drawn
  # in is a different colour in each and a mark that vanished in one of them
  # would ship green from the other.
  #
  # The bar's own paint rides along here: it covers records as they pass beneath
  # it, so it must be opaque in both themes rather than the header's translucency.
  Scenario Outline: A submitted retro says so on the bar, with a shape and a word, in the <theme> theme
    Given the reviewer has set dark mode to "<theme>"
    When the reviewer approves record "r-stale-lock"
    And the reviewer declines record "r-bullet-responses"
    And the reviewer approves record "r-silent-tailer"
    And the reviewer finishes the review
    And the AI closes the review
    Then the review is finished
    And the submitted mark carries a shape and a word
    And finishing is no longer on the bar
    And the decision bar is painted, not see-through

    Examples:
      | theme |
      | light |
      | dark  |

  Scenario: Finishing is refused while any record is undecided, and it names them
    When the reviewer approves record "r-stale-lock"
    And the reviewer presses Finish review
    Then the review is refused over "r-bullet-responses, r-silent-tailer"
    And the review is not finished

  # Records did not use to have a unique id — each retro's record ids started
  # from #1, which read as if two different records shared a number. So a
  # record has one number, its place in the whole ledger, and it is that number
  # everywhere it is named — the card, the index, a comment's anchor, the chip
  # that says where the composer is aimed, and the refusal that lists what is
  # still undecided. Five surfaces that each name a record, and five chances for
  # one of them to keep the old numbering.
  #
  # It is `r-doctor-blind` in all five, and only that record, because it is the
  # one in this fixture whose two numbers differ: it arrives with revision 3, by
  # which time two other retrospectives already hold five records between them —
  # so it is record 4 of this retro and #8 of the store. Every assertion below
  # would pass on a page still printing `num` if it were made on any other record
  # here, which is why the stage is the wide one.
  Scenario: A record is named by the same number on every surface that names it
    Given the reviewer opens retro 1 on a stage of three retrospectives
    When the AI files the next revision
    And the reviewer loads the announced revision
    Then the record index entry for "r-doctor-blind" reads "#8" and "The doctor passes a stage the server will not serve"
    And record "r-doctor-blind" is numbered "#8"
    When the reviewer starts a comment on the "problem" of record "r-doctor-blind"
    Then the composer is aimed at "#8 · Problem · The doctor passes a stage the server will not serve"
    When the reviewer comments "Which stage does it open?" on the "problem" of record "r-doctor-blind"
    Then the "problem" thread of record "r-doctor-blind" is anchored to "#8 · Problem · The doctor passes a stage the server will not serve"
    When the reviewer presses Finish review
    Then the refusal names record "r-doctor-blind" as "#8 The doctor passes a stage the server will not serve"
    And the browser reported no console errors

  # The refusal used to be a box under the action, in a column with room for one.
  # A one-line bar has none, so it is a popover on the button that refused —
  # which is where the reviewer is looking when it happens — and a popover has to
  # give the page back or it is the box again in a worse place. Two ways out, and
  # the keyboard comes back to the control that opened it either way.
  Scenario: The refusal gives the page back on Escape, and the keyboard with it
    When the reviewer approves record "r-stale-lock"
    And the reviewer presses Finish review
    Then the review is refused over "r-bullet-responses, r-silent-tailer"
    When the reviewer presses the Escape key
    Then the review is no longer refused
    And the keyboard is on the finish button

  Scenario: A press anywhere else on the page dismisses the refusal too
    When the reviewer approves record "r-stale-lock"
    And the reviewer presses Finish review
    Then the review is refused over "r-bullet-responses, r-silent-tailer"
    When the reviewer clicks outside the refusal
    Then the review is no longer refused

  # Finishing became a two-step act: clicking Finish, and if the review is
  # actually valid and can be closed, a text box where the human can enter a
  # final message before closing — delivered separately from the comments.
  #
  # The guard for validity already shipped — the gate refuses while a
  # record is undecided, which is the block above. This is the half that had not:
  # a *valid* finish confirms, and the confirm is where the round's last word
  # goes. Delivered separately from the comments, so nothing here is a thread.
  Scenario: A valid finish asks before it fires, and nothing is sent until it is answered
    When the reviewer approves record "r-stale-lock"
    And the reviewer declines record "r-bullet-responses"
    And the reviewer approves record "r-silent-tailer"
    And the reviewer presses Finish review
    Then the finish confirm is open, offering a final message that is optional
    And the review has not been finished at all
    And the review is not finished

  Scenario: The final message travels with the finish, on the round
    When the reviewer approves record "r-stale-lock"
    And the reviewer declines record "r-bullet-responses"
    And the reviewer approves record "r-silent-tailer"
    And the reviewer presses Finish review
    And the reviewer writes the final message "Ship the first two; the third can wait for next week."
    And the reviewer confirms the finish
    Then the reviewer is told the round is with the AI
    And the round carries the final message "Ship the first two; the third can wait for next week."

  # Optional means optional: the confirm is the act, and the box is something the
  # reviewer may leave alone. Nothing is ever inferred from an empty field.
  Scenario: Confirming with an empty box finishes the round and sends no message
    When the reviewer approves record "r-stale-lock"
    And the reviewer declines record "r-bullet-responses"
    And the reviewer approves record "r-silent-tailer"
    And the reviewer presses Finish review
    And the reviewer confirms the finish
    Then the reviewer is told the round is with the AI
    And the round carries no final message

  # A box holding only whitespace is an empty box. It is enforced in the core use
  # case rather than here, so the CLI and the api obey the same rule; this is the
  # page's half of it.
  Scenario: A box holding only spaces is not a message
    When the reviewer approves record "r-stale-lock"
    And the reviewer declines record "r-bullet-responses"
    And the reviewer approves record "r-silent-tailer"
    And the reviewer presses Finish review
    And the reviewer writes the final message "   "
    And the reviewer confirms the finish
    Then the reviewer is told the round is with the AI
    And the round carries no final message

  # The confirm has to give the page back, exactly as the refusal does — and
  # backing out of it must leave the round untouched, which is the whole
  # reason the second step exists.
  Scenario: Backing out of the confirm finishes nothing and gives the keyboard back
    When the reviewer approves record "r-stale-lock"
    And the reviewer declines record "r-bullet-responses"
    And the reviewer approves record "r-silent-tailer"
    And the reviewer presses Finish review
    And the reviewer presses the Escape key
    Then the finish confirm is closed
    And the review has not been finished at all
    And finishing is still offered
    And the keyboard is on the finish button

  # The refusal used to arrive after pressing finish, and after the
  # finishing message might already have been entered — a risk of losing
  # the human's input, since the check should show on the first click
  # rather than the second.
  #
  # The gate predates the two-step and stayed attached to the send, so an
  # earlier redesign silently reordered check and composition. Everything the
  # refusal needs is on the page before the first press — the popover names the
  # records by their global ids — so the composer is simply unreachable on a round
  # that cannot finish, and there is no composed text to lose. The order is the
  # claim, so the absence of the composer is asserted next to the refusal.
  Scenario: The refusal arrives on the first press, and the composer never opens
    When the reviewer approves record "r-stale-lock"
    And the reviewer presses Finish review
    Then the review is refused over "r-bullet-responses, r-silent-tailer"
    And the finish confirm is closed
    And the review has not been finished at all
    And the review is not finished

  # The other path, and the reason the server's check stays where it is: a verdict
  # can be taken back between the composer opening and the send — an undo on
  # another device, whose event has not reached this page yet — so the send can
  # still be refused on a round the page believed was finishable.
  #
  # That is the one case where a refusal fires with something written in the
  # box, which is exactly the risk named above. The text is kept: pressing
  # Finish again brings back the last written word on the round, still
  # there, unsent and unedited. The input-loss risk dies on both paths — by
  # never writing on one, and by never discarding on the other.
  Scenario: A verdict taken back elsewhere is refused at send time, and the draft survives it
    When the reviewer approves record "r-stale-lock"
    And the reviewer declines record "r-bullet-responses"
    And the reviewer approves record "r-silent-tailer"
    And the reviewer presses Finish review
    Then the finish confirm is open, offering a final message that is optional
    When the reviewer writes the final message "Ship the first two; the third can wait for next week."
    And another device undoes the verdict on record "r-silent-tailer"
    And the reviewer confirms the finish
    Then the review is refused over "r-silent-tailer"
    And the finish confirm is closed
    And the review has not been finished at all
    When the reviewer presses the Escape key
    And the reviewer presses Finish review
    Then the finish confirm still holds "Ship the first two; the third can wait for next week."

  # Pressing finish review used to say sent, but refreshing the page brought
  # the finish review button back enabled again.
  #
  # The press had landed — the armed monitor had the ReviewFinished for exactly
  # that revision while the refreshed page was still offering the button — so this
  # was a read-side gap and not a write-side one. The bar's Sent state was
  # in-memory only, and the finished-this-revision fact was on no query the page
  # held: `revisionMeta.finishedAt` now carries it, and the bar
  # derives from it.
  #
  # The earlier gap left exactly this untested: it tested the press path,
  # and no scenario put anything between the press and the assertion.
  Scenario: The submitted state survives the reviewer leaving the page and coming back
    When the reviewer approves record "r-stale-lock"
    And the reviewer declines record "r-bullet-responses"
    And the reviewer approves record "r-silent-tailer"
    And the reviewer finishes the review
    Then the reviewer is told the round is with the AI
    When the reviewer leaves the review and comes back
    Then the reviewer is told the round is with the AI
    And finishing is no longer offered
    And the review is not finished

  # The other side of the same fact, and the reason it is per revision rather than
  # per retrospective: the AI files the next round and the button comes back. A
  # `finishedAt` read off the retrospective would have kept it disabled forever.
  Scenario: A round the human has not finished still offers the button after a round trip
    When the reviewer approves record "r-stale-lock"
    And the reviewer declines record "r-bullet-responses"
    And the reviewer approves record "r-silent-tailer"
    And the reviewer finishes the review
    And the AI files the next revision
    And the reviewer loads the announced revision
    And the reviewer leaves the review and comes back
    Then finishing is offered again

  Scenario: Finishing closes the review once every record has a verdict
    When the reviewer approves record "r-stale-lock"
    And the reviewer declines record "r-bullet-responses"
    And the reviewer approves record "r-silent-tailer"
    And the reviewer finishes the review
    And the AI closes the review
    Then the review is finished
    And record "r-stale-lock" offers no decision buttons

  # Two buttons used to encode one judgment twice, and the contradiction
  # they invite: requesting a lot of changes in comments and then also
  # clicking finish review is a contradiction that a single button avoids —
  # there is just one button now.
  #
  # So the page's whole terminal surface is one button, and these three
  # scenarios are what it means: what it offers, what it says when pressed, and
  # that it cannot be pressed twice.

  Scenario: The review offers one terminal action, and it is Finish review
    Then the review actions offer the buttons "Finish review"

  # The header word here is SUBMITTED and not REVIEWING, and the
  # two assertions under it are why that is not the same claim twice: `the review
  # is not finished` says the retrospective did NOT end on the press — the
  # doctrine this scenario is named for — and the header word says the page now
  # tells the reviewer which half of the window they are in. Before the
  # fourth word existed the only surface saying so was the bar's own mark,
  # one line below.
  Scenario: Finishing says so, and does not end the retrospective on its own
    When the reviewer approves record "r-stale-lock"
    And the reviewer declines record "r-bullet-responses"
    And the reviewer approves record "r-silent-tailer"
    And the reviewer finishes the review
    Then the reviewer is told the round is with the AI
    And the review is not finished
    And the review header says the retro is "submitted"

  # The finish action used to be pressable multiple times. Both layers hold
  # it to once per round — the button goes unpressable, and the server
  # absorbs a duplicate anyway (`review.test.ts`, `procedures.test.ts`). Two
  # scenarios rather than one, because they are two claims and a scenario
  # that stopped at the first would never reach the second.
  Scenario: The terminal action cannot be pressed a second time
    When the reviewer approves record "r-stale-lock"
    And the reviewer declines record "r-bullet-responses"
    And the reviewer approves record "r-silent-tailer"
    And the reviewer finishes the review
    Then finishing is no longer offered

  Scenario: Pressing at it again fires nothing at all
    When the reviewer approves record "r-stale-lock"
    And the reviewer declines record "r-bullet-responses"
    And the reviewer approves record "r-silent-tailer"
    And the reviewer finishes the review
    And the reviewer presses finish again
    Then the review was finished exactly once

  # The other half of once-per-round: a round is a revision, so the next
  # revision may be finished too. Without this the loop would end at round one.
  Scenario: The next revision may be finished in its turn
    When the reviewer approves record "r-stale-lock"
    And the reviewer declines record "r-bullet-responses"
    And the reviewer approves record "r-silent-tailer"
    And the reviewer finishes the review
    And the AI files the next revision
    And the reviewer loads the announced revision
    Then finishing is offered again

  # The review workflow — filter to pending, and as each
  # record is decided it falls out of the filter. Whole records only: a record
  # that is on screen is still on screen entire.

  # A chip per state a review can reach, and each one keeps its place at zero:
  # "no records are declined" is an answer, and a bar that changed length with
  # the counts would be harder to aim at.
  #
  # `hold` is not one of those states. It stopped being a verdict and
  # nothing has written one since, so on every store in use it is a chip
  # that can only read zero and filter to nothing — dead chrome on every
  # real retro, and every element earns its place. It is gone from the bar
  # here and present in the scenario below it, which is the whole of the
  # rule.
  Scenario: The filter offers the states a review can reach, and filters nothing until it is used
    Then no filter chip is active
    And the filter offers the chips "pending, approved, declined, revise"
    And the filter counts read:
      | pending  | 3 |
      | approved | 0 |
      | declined | 0 |
      | revise   | 0 |
    And the records appear in the order "r-stale-lock, r-bullet-responses, r-silent-tailer"

  # The other half: a verdict a human once chose stays findable, because human
  # data is append-only. Gating the chip is a rendering rule and nothing else —
  # `record list --state hold`, the wire enum and the export all go on admitting
  # one (data-model.md §Read-only historical `hold` verdicts).
  Scenario: A store that carries a hold verdict is still offered the chip that finds it
    Given the review carries a decision recorded as "hold"
    And the reviewer opens retro 1
    Then the filter offers the chips "pending, approved, declined, revise, hold"
    And the filter counts read:
      | pending  | 2 |
      | approved | 0 |
      | declined | 0 |
      | revise   | 0 |
      | hold     | 1 |
    When the reviewer filters to "hold"
    Then the records appear in the order "r-stale-lock"
    And record "r-stale-lock" is "hold"

  Scenario: The counts follow the decisions
    When the reviewer approves record "r-stale-lock"
    And the reviewer declines record "r-silent-tailer"
    And the reviewer asks for a revision of record "r-bullet-responses"
    Then the filter counts read:
      | pending  | 0 |
      | approved | 1 |
      | declined | 1 |
      | revise   | 1 |

  Scenario: Filtering to pending shows the records still waiting, and only those
    When the reviewer approves record "r-bullet-responses"
    And the reviewer filters to "pending"
    Then the records appear in the order "r-stale-lock, r-silent-tailer"
    And record "r-bullet-responses" is not listed

  Scenario: The chips are independent, and a combination shows the union of what they name
    When the reviewer approves record "r-stale-lock"
    And the reviewer declines record "r-bullet-responses"
    And the reviewer filters to "pending"
    And the reviewer filters to "approved"
    Then the records appear in the order "r-stale-lock, r-silent-tailer"
    And record "r-bullet-responses" is not listed

  Scenario: A decided record falls out of the pending filter and the page moves on to the next one
    When the reviewer filters to "pending"
    And the reviewer approves record "r-stale-lock"
    Then record "r-stale-lock" is not listed
    And the records appear in the order "r-bullet-responses, r-silent-tailer"
    And the viewport lands on record "r-bullet-responses"
    And the filter counts read:
      | pending | 2 |

  # The departing row's height once stepped from full to zero between two
  # consecutive frames and only the opacity faded, in every run including
  # unloaded baselines. The element carried a 0.24s transition on
  # `grid-template-rows`, and the code said in as many words that the
  # records below "rise into the gap instead of jumping into it" — they
  # jumped every time a decided record left a filtered view.
  #
  # No assertion on a final state can see this: the row ends at zero height
  # whether it animated or not, and the opacity half ran correctly over the same
  # window, which is what made the jump read as motion for four sessions. So the
  # scenario records the frames in between and asks whether the height was ever a
  # value nothing in the code wrote.
  Scenario: A departing record collapses through the heights between, rather than stepping to zero
    When the reviewer filters to "pending"
    And the collapse of record "r-stale-lock" is traced
    And the reviewer approves record "r-stale-lock"
    Then record "r-stale-lock" collapsed through the heights between

  # The eye was taken to the next record
  # and the keyboard was not: the card the reviewer was working in leaves the
  # document, focus falls to `<body>`, and reaching the verdict buttons of the
  # record now under the cursor costs a tab-walk from the top of the page —
  # once per record, down a filtered list, which is the whole workflow.
  Scenario: The keyboard lands where the page lands, so the next verdict is one tab away
    When the reviewer filters to "pending"
    And the reviewer approves record "r-stale-lock"
    Then the viewport lands on record "r-bullet-responses"
    And the keyboard is on record "r-bullet-responses"

  # The fallback landing, with the keyboard on it: the record that left was the
  # last one, so the successor is the record before it.
  Scenario: The keyboard follows the fallback landing too
    When the reviewer filters to "pending"
    And the reviewer approves record "r-silent-tailer"
    Then the viewport lands on record "r-bullet-responses"
    And the keyboard is on record "r-bullet-responses"

  # The other half: there is no next record, so the page falls back to
  # the one before — which is above where the reviewer was sitting, so nothing
  # but a deliberate landing can put it at the top of the reading area.
  Scenario: When the record that left was the last one, the page falls back to the one before it
    When the reviewer filters to "pending"
    And the reviewer approves record "r-silent-tailer"
    Then record "r-silent-tailer" is not listed
    And the viewport lands on record "r-bullet-responses"

  # The departure is an animation and the landing is a smooth scroll, so both
  # have an off switch the reviewer never asked us for. Turning it off may not
  # cost them the workflow: the record still leaves and the page still lands.
  Scenario: A reviewer who asked for less motion still keeps their place
    Given the reviewer has asked for reduced motion
    When the reviewer filters to "pending"
    And the reviewer approves record "r-silent-tailer"
    Then record "r-silent-tailer" is not listed
    And the viewport lands on record "r-bullet-responses"

  # This scenario is re-scoped by its own trace.
  #
  # The hypothesis was that a departure shrinks the document and the
  # browser clamps scrollY in the same layout pass the landing scroll is issued
  # in, cancelling it — an unverified relay that needed a trace to confirm or
  # rule out first. About 2,350 instrumented runs ruled it out. In every
  # captured failure and in every baseline the shrink and the browser's
  # adjustment had already completed before `scrollIntoView` was called, and
  # the landing that was issued was correct and did arrive — at the right
  # pixel, with `scrollend` fired.
  #
  # What was actually failing is the *wait*. `scrollAtRest` concluded the page
  # had stopped by counting unchanged frames, and on a renderer that has almost
  # stopped painting those frames are seconds apart: the landing arrives, and the
  # wait then owes three more frames before it will say so. That tax, not the
  # scroll, is what ran past the assertion's budget — and while it ran, every
  # sample read the same mid-flight position, which is exactly the stable
  # offset for the full fifteen seconds that was observed.
  #
  # So this scenario starves the renderer on purpose rather than borrowing a
  # loaded machine, and asserts the landing is *read* correctly. It is red on the
  # frame-counted wait and green on the one that settles when the scroll says it
  # has ended.
  #
  # @starved, and it is the scenario this tag was written for: starving its
  # own renderer is what puts it in the class, and its fifteen-second budget
  # is what the class costs. Measured on this tip: green at the gate's five
  # workers, and 12 of 12 red at twelve concurrent copies on twelve workers —
  # the same fifteen-second predicate timeout every time, the page alive in
  # all of them. The budget did not move; the scenario left the parallel
  # bulk.
  @starved
  Scenario: The landing is read correctly on a renderer that has almost stopped painting
    When the reviewer filters to "pending"
    And the reviewer approves record "r-stale-lock"
    And the renderer paints once every 4 seconds for 40 seconds
    Then the viewport lands on record "r-bullet-responses"

  # This scenario used to end on
  # `toBeInViewport` for the review actions — an assertion that could not fail
  # in the state it reaches: every record has been filtered off the page, so the
  # actions are on screen whether the page landed on them or never moved at all.
  # Where the reviewer was actually put down is the thing being claimed, and the
  # keyboard is the only witness to it that a short page cannot fake.
  Scenario: Deciding the last record in the filter empties it without stranding the reviewer
    When the reviewer filters to "pending"
    And the reviewer approves record "r-stale-lock"
    And the reviewer declines record "r-bullet-responses"
    And the reviewer approves record "r-silent-tailer"
    Then no records are listed
    And the page lands on the review actions
    And the filter counts read:
      | pending | 0 |
    When the reviewer finishes the review
    Then the reviewer is told the round is with the AI

  # Filters by status (pending, approved, etc.) get filters by type too — by
  # who raised the item, AI or human, with a count of how many issues each
  # side raised. The design keeps what already exists and adds an icon that
  # opens a pop-up with the additional filters, with some indication shown
  # that extra filters are applied.
  #
  # So: the state chips stay, the two new slices live behind one icon, and the
  # applied state is visible without opening it.
  Scenario: The bar keeps its chips and adds one icon that opens the rest
    Then the filter offers the chips "pending, approved, declined, revise"
    And no extra filter is applied
    When the reviewer opens the extra filters
    Then the extra filters read:
      | requester | human   | 2 |
      | requester | ai      | 1 |
      | type      | issue   | 2 |
      | type      | feature | 1 |

  Scenario: Filtering by who raised it shows only that side's records
    When the reviewer opens the extra filters
    And the reviewer filters to requester "ai"
    Then the records appear in the order "r-silent-tailer"
    And record "r-stale-lock" is not listed

  Scenario: Filtering by what it is shows only records of that kind
    When the reviewer opens the extra filters
    And the reviewer filters to type "feature"
    Then the records appear in the order "r-bullet-responses"

  # Three dimensions, one list: they narrow together rather than replacing each
  # other, which is what makes "AI issues, still pending" a question you can ask.
  Scenario: Requester, type and state narrow together
    When the reviewer filters to "pending"
    And the reviewer opens the extra filters
    And the reviewer filters to requester "human"
    Then the records appear in the order "r-stale-lock, r-bullet-responses"
    When the reviewer filters to type "issue"
    Then the records appear in the order "r-stale-lock"
    And record "r-bullet-responses" is not listed

  # The chips show the total count rather than the number currently on
  # screen. The chips answer "how much is there", not "how much is on
  # screen" — so an extra filter narrows the list and leaves every chip's
  # number alone.
  Scenario: The state chips keep total counts while an extra filter narrows the list
    When the reviewer opens the extra filters
    And the reviewer filters to requester "ai"
    Then the records appear in the order "r-silent-tailer"
    And the filter counts read:
      | pending  | 3 |
      | approved | 0 |
      | declined | 0 |
      | revise   | 0 |

  # The indication has both halves of it — so "why is the list short"
  # cannot happen — and one press to undo it.
  Scenario: An applied extra filter says so on the icon and beside it, and clears in one press
    When the reviewer opens the extra filters
    And the reviewer filters to requester "ai"
    And the reviewer filters to type "issue"
    Then the extra filters are applied, and the chip beside the icon reads "AI · Issue"
    When the reviewer clears the applied filters
    Then no extra filter is applied
    And the records appear in the order "r-stale-lock, r-bullet-responses, r-silent-tailer"

  # The applied state is a *drawing*, and it is drawn in
  # different colours in each theme — a badge that vanished into its background in
  # one of them would ship green from the other. Read channel by channel, because
  # "it looks different somehow" is not the claim: the icon changes fill and ink
  # together, and the badge has to be painted in something the bar behind it is
  # not.
  Scenario Outline: An applied extra filter is visible on the bar, in the <theme> theme
    Given the reviewer has set dark mode to "<theme>"
    When the reviewer opens the extra filters
    And the reviewer filters to requester "ai"
    Then the extra-filter icon reads as applied, on every channel it promises

    Examples:
      | theme |
      | light |
      | dark  |

  # At the end of deciding a round, when there is no more pending, the page
  # needs a nice and sweet message that says there are no more items that
  # match the selected criteria — otherwise it looks like a bug that
  # everything vanished all of a sudden, when actually the filtered items
  # really don't have anything left.
  #
  # The list used to just end. The scenario below it — "Deciding the last record
  # in the filter empties it without stranding the reviewer" — proves the page
  # keeps the reviewer; this proves the page tells them why.
  Scenario: Deciding the last record under a filter says so, where the records were
    When the reviewer filters to "pending"
    And the reviewer approves record "r-stale-lock"
    And the reviewer declines record "r-bullet-responses"
    And the reviewer approves record "r-silent-tailer"
    Then no records are listed
    And the emptied filter says so, and counts 3 decided records hidden

  # Composes with the additional-filters feature, and the message names the *state* rather
  # than the chips: whichever combination emptied the list, the sentence is the
  # same one. Nothing is decided here, so the count clause has nothing to say and
  # is left off — a "0 decided records are hidden" would read exactly like the
  # bug this record exists to stop looking like.
  #
  # The combination is the point: the fixture has an AI-raised issue and a
  # human-raised feature, so neither extra filter empties the list on its own and
  # the two together do.
  Scenario: An extra-filter combination that empties the list says so too
    When the reviewer opens the extra filters
    And the reviewer filters to requester "ai"
    And the reviewer filters to type "feature"
    Then no records are listed
    And the emptied filter says so, and counts no decided records hidden

  # "Only when filters cause it": a page showing records has nothing to explain,
  # and a retro with no records at all keeps whatever story it already had.
  Scenario: A list with records in it explains nothing
    Then the records appear in the order "r-stale-lock, r-bullet-responses, r-silent-tailer"
    And the emptied-filter message is nowhere on the page

  Scenario: Turning the chip off brings every record back, decided and not
    When the reviewer filters to "pending"
    And the reviewer approves record "r-stale-lock"
    Then record "r-stale-lock" is not listed
    When the reviewer clears the "pending" filter
    Then the records appear in the order "r-stale-lock, r-bullet-responses, r-silent-tailer"
    And record "r-stale-lock" is "approved"

  # G2 (v2 C21, v1 #1): the index rail. A review is one long scroll, and the
  # rail is the only thing on the page that says how much of it there is, what
  # has been dealt with, and how to get back to a record.

  Scenario: The rail indexes every record, in order, with its number, title and state
    Then the record index lists "r-stale-lock, r-bullet-responses, r-silent-tailer"
    And the record index entry for "r-stale-lock" reads "#1" and "Deploy blocked on a stale lock file"
    And the record index entry for "r-bullet-responses" reads "#2" and "Answers come back as bullet lists when prose was asked for"
    And the record index entry for "r-silent-tailer" reads "#3" and "The tailer stops without saying so"
    And the record index entry for "r-stale-lock" is "pending"

  Scenario: A rail entry is one click to that record
    When the reviewer jumps to record "r-silent-tailer" from the record index
    Then the viewport lands on record "r-silent-tailer"

  Scenario: A verdict changes that record's mark in the rail, without a reload
    Then the record index entry for "r-stale-lock" is "pending"
    When the reviewer approves record "r-stale-lock"
    Then the record index entry for "r-stale-lock" is "approved"
    And the record index entry for "r-silent-tailer" is "pending"

  # The index lists everything or it is not an index — a reviewer filtered down
  # to two records must still be able to see that there were three. What it will
  # not do is offer to take them somewhere that is not on the page.
  Scenario: A record the filter is hiding keeps its place in the rail, dimmed and inert
    When the reviewer approves record "r-stale-lock"
    And the reviewer filters to "pending"
    Then record "r-stale-lock" is not listed
    And the record index lists "r-stale-lock, r-bullet-responses, r-silent-tailer"
    And the record index entry for "r-stale-lock" is "approved"
    And the record index entry for "r-stale-lock" is dimmed and inert
    And the record index entry for "r-bullet-responses" leads to that record

  # ux-brief 04's three screens. The rail needs a third column; below that width
  # the index is one glyph in the header and a sheet that opens from the left —
  # never both, because two copies of the same list in one document is one too
  # many and whichever a reader reached would be a coin toss.
  #
  # It shipped the other way at first: on the portrait iPad the reading
  # column was the whole screen and the rail stepped out of the way — no
  # drawer, no button to open it, because a two-tap index on a page you can
  # scroll was judged not worth the tap or the code. That was overturned: on
  # iPad the issues list that lets a reader jump to specific issues needed
  # to be reachable, opening in a left panel just like comments open from
  # the right panel.
  Scenario Outline: The index is a rail where there is room for one, and a left sheet where there is not
    Given the reviewer's screen is <width> by <height>
    And the reviewer opens retro 1
    Then the rail <presence>
    And the record index affordance <affordance>
    And the records appear in the order "r-stale-lock, r-bullet-responses, r-silent-tailer"
    # The same numbers dashboard.feature asserts of its own page, which is
    # what makes the home page's width not matching the retro page's width
    # checkable.
    And the page is <measure> pixels wide
    And the page does not scroll sideways
    And the browser reported no console errors

    # The two rows in the middle are the breakpoint, a pixel apart, and they are
    # here because three things step together at it or the page is wrong: the
    # measure widens, the rail mounts, and the glyph that stands in for the rail
    # goes away. 1472 has all three columns; 1471 is the portrait iPad's layout
    # on a laptop-sized screen, which is what "there is no room for the third
    # column" has always meant.
    #
    # 1920 is the other rule — on a very wide screen the content should not
    # go all the way to the sides — and the assertion is that the measure
    # stops at 1536 rather than following the screen out to its edges.
    #
    # **The last three rows are the price of the wider breakpoint, written
    # down.** All three canonical viewports (testing.md) are on the narrow
    # side of the breakpoint now: at 84rem the 1440 laptop and the 1366
    # landscape iPad both had three columns, and rails of 288 + 368 do not
    # fit either of them above the reading column's 704px floor. Nothing
    # the product is actually reviewed on shows the wide layout any more —
    # the rail numbers are the dial, and this table is what they move.
    Examples:
      | width | height | presence         | affordance     | measure |
      | 1920  | 1080   | is on screen     | is not offered | 1536    |
      | 1536  | 960    | is on screen     | is not offered | 1536    |
      | 1472  | 900    | is on screen     | is not offered | 1472    |
      | 1471  | 900    | is not on screen | is offered     | 1024    |
      | 1440  | 900    | is not on screen | is offered     | 1024    |
      | 1366  | 1024   | is not on screen | is offered     | 1024    |
      | 1024  | 1366   | is not on screen | is offered     | 1024    |

  # The same sheet as the comments panel, mirrored.
  # It opens from the left because that is the side the rail lives on, and
  # because a page with one sheet from each edge is a page whose two panels can
  # be told apart before they finish opening.
  Scenario: On the portrait iPad the index opens in a panel on the left
    Given the reviewer's screen is 1024 by 1366
    And the reviewer opens retro 1
    When the reviewer opens the record index
    Then the record index is open
    And the record index opens from the left
    And the rail is not on screen
    And the record index lists "r-stale-lock, r-bullet-responses, r-silent-tailer"
    And the record index entry for "r-stale-lock" reads "#1" and "Deploy blocked on a stale lock file"

  # Jumping to a specific record closes the sheet on the way, because the
  # record it lands on is under the backdrop and scrolling to it without
  # closing would put the reviewer somewhere they cannot see. Both halves
  # asserted: the sheet gave the page back *and* the page went where it was
  # asked.
  Scenario: An entry in the sheet jumps to that record and gives the page back
    Given the reviewer's screen is 1024 by 1366
    And the reviewer opens retro 1
    When the reviewer opens the record index
    And the reviewer jumps to record "r-silent-tailer" from the record index
    Then the record index is closed
    And the viewport lands on record "r-silent-tailer"

  # The rotation rule, the comments sheet's own: crossing into the rail's width
  # takes the sheet off the page and it must not be waiting there on the way
  # back, or a screen widened and narrowed again comes home to a panel nobody
  # tapped. Like its twin it crosses the breakpoint with a viewport change rather
  # than a rotation now, because since the breakpoint moved to 92rem an
  # iPad turned end to end never crosses it.
  Scenario: The index sheet does not come back by itself once the page has crossed the breakpoint and back
    Given the reviewer's screen is 1024 by 1366
    And the reviewer opens retro 1
    When the reviewer opens the record index
    And the reviewer turns the iPad to 1536 by 960
    Then the rail is on screen
    And the record index is closed
    When the reviewer turns the iPad to 1024 by 1366
    Then the record index affordance is offered
    And the record index is closed

  Scenario: The backdrop closes the index too
    Given the reviewer's screen is 1024 by 1366
    And the reviewer opens retro 1
    When the reviewer opens the record index
    And the reviewer clicks outside the record index
    Then the record index is closed

  # The index is the same index in either mount, so the rule that makes it an
  # index rather than a second filter holds in the sheet too: every record is
  # listed, and the ones the filter took off the page lead nowhere.
  Scenario: A record the filter is hiding is dimmed and inert in the sheet as well
    Given the reviewer's screen is 1024 by 1366
    And the reviewer opens retro 1
    When the reviewer approves record "r-stale-lock"
    And the reviewer filters to "pending"
    And the reviewer opens the record index
    Then the record index lists "r-stale-lock, r-bullet-responses, r-silent-tailer"
    And the record index entry for "r-stale-lock" is dimmed and inert
    And the record index entry for "r-bullet-responses" leads to that record
