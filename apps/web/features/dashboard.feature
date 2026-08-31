Feature: The dashboard

  The composed dashboard (session 12). The owner ran a direction round over three
  variations against his real store and ruled for one composition, top to bottom:
  the menu untouched, a conditional band for retrospectives in flight, four stat
  tiles, one chart switchable across four axes, ten rows behind the numbers, and
  the diary of sittings underneath.

  Two blocks he removed by name — the solution-level donut and the severity radar
  — are gone, and so is the records-first corpus block this page led with in
  session 11. Its severity table and proportion bar are not "moved"; the chart and
  the tiles are what replaced them.

  Which fixture each scenario runs on is a discrimination decision, not a
  convenience. The one-retrospective fixture has a round in flight, so it is where
  the band's presence and the readings tabs are proved: its three cuts count 3, 2
  and 0, three different numbers. The three-retrospective fixture (`crossRetro`)
  is where the corpus tiles are proved, because there the axes disagree — seven
  records, five open, and involvement splitting 1 interactive against 2
  pull-request, so a tile reading the wrong half of the pair cannot land on both.

  The relative-date boundary is NOT proved here. The fixture's timestamps are
  constants, so a scenario asserting "4 days ago" would go red by the calendar
  rather than by a code change; the boundary is proved against an injected clock
  in test/relative-when.spec.ts, and what the browser asserts is the machine-
  readable instant on the `<time>` element.

  # r-untested-rendered-branch (retro 3). The quiet line a fresh install lands on
  # shipped with nothing in the suite referring to it: the fixture has always had
  # a retrospective in it, so the branch was rendered code no test had reached.
  Scenario: A fresh install says the one true thing and stops
    Given the AI has never filed a revision
    And the reviewer opens the dashboard of a fresh install
    Then the dashboard says "No retrospectives yet. The first one lands here when the AI files a revision."
    And there is no band for retrospectives in flight
    And the browser reported no console errors

  # ── direction 6: the exclusive surface for a round in flight ───────────────
  #
  # "Exclusively" has two halves and both are asserted: the band is *there* with
  # the round that is in flight, and it is *absent* the moment nothing is. The
  # absence half is the one that matters — a permanent strip reading "nothing
  # open" is the control the direction was filed against.
  Scenario: A retrospective in flight gets a band of its own
    Given the reviewer opens the dashboard
    Then the band names 1 retrospective in flight
    And the band's row for retro 1 is "reviewing"
    And the band's row for retro 1 shows 3 awaiting the reviewer
    And the band's row for retro 1 identifies it as "Retro 1 · session 1"
    And the browser reported no console errors

  # The band goes when the last round closes, and the rest of the page stays. Run
  # through the product — the reviewer answers every record, finishes, the AI
  # closes — because nothing arranged can prove a *disappearance* that a reader
  # would see.
  Scenario: The band is gone once nothing is in flight
    Given the reviewer opens retro 1
    When the reviewer approves record "r-stale-lock"
    And the reviewer approves record "r-bullet-responses"
    And the reviewer approves record "r-silent-tailer"
    And the reviewer finishes the review
    And the AI closes the review
    And the reviewer goes back to the dashboard
    Then there is no band for retrospectives in flight
    And the dashboard counts 3 records
    And the browser reported no console errors

  # ── the fourth word: his round is down, the AI has not closed it ──────────
  #
  # The owner's session-11 add, carried on his ack at every close since: "There
  # should be a status in between that indicates that the human has submitted but
  # AI hasn't closed". The dashboard is the surface it was missing from — the
  # review bar has said "Retro submitted" at the bottom of the review page since
  # session 6, and the row he actually looks at said REVIEWING for the whole of
  # that window, which is the same word it says while the round is untouched.
  #
  # Run through the product, because the state is a reading of an act: nothing
  # arranged could tell a derivation from a fixture. The awaiting-you figures are
  # asserted GONE rather than zero — a round he has put down owes him nothing, and
  # "0 awaiting you" is the number to read and dismiss the band was written
  # against — and the button falls to Open it with them.
  Scenario: A round he has submitted says so on the band and in the diary
    Given the reviewer opens retro 1
    When the reviewer approves record "r-stale-lock"
    And the reviewer approves record "r-bullet-responses"
    And the reviewer approves record "r-silent-tailer"
    And the reviewer finishes the review
    And the reviewer goes back to the dashboard
    Then the band names 1 retrospective in flight
    And the band's row for retro 1 is "submitted"
    And the band's row for retro 1 shows no figures
    And the band's row for retro 1 offers "Open it"
    And the diary's row for retro 1 is "submitted"
    And the diary's row for retro 1 counts nothing pending
    And the browser reported no console errors

  # The far edge of the same window, and the one that says SUBMITTED is not a
  # second name for finished: the AI's close is a separate act in its own process,
  # and only it takes the retro off the band.
  Scenario: The AI's close turns the submitted round into a finished one
    Given the reviewer opens retro 1
    When the reviewer approves record "r-stale-lock"
    And the reviewer approves record "r-bullet-responses"
    And the reviewer approves record "r-silent-tailer"
    And the reviewer finishes the review
    And the reviewer goes back to the dashboard
    Then the band's row for retro 1 is "submitted"
    When the reviewer opens retro 1 from the dashboard
    And the AI closes the review
    And the reviewer goes back to the dashboard
    Then there is no band for retrospectives in flight
    And the diary's row for retro 1 is "finished"
    And the browser reported no console errors

  # r-theme-blind-assertions: the new tag look is colour, and colour is the one
  # thing a dark override can suppress without anything else moving. Asserted in
  # both themes, and asserted as a *separation* rather than as a value: the words
  # on this page are SUBMITTED and FINISHED, and if the two ever resolved to the
  # same fill and ink the tag would be carrying its state on the word alone.
  #
  # The three-retrospective fixture is what makes the pair available on one page
  # — two of its retros are already finished — so both looks are measured in the
  # same document, in the same theme, with no navigation between them.
  Scenario Outline: Two retro states never wear one look, in the <theme> theme
    Given the stage holds the retrospectives of two sessions
    And the reviewer opens the dashboard
    And the reviewer has set dark mode to "<theme>"
    And the reviewer opens retro 1 from the dashboard
    When the reviewer approves record "r-stale-lock"
    And the reviewer approves record "r-bullet-responses"
    And the reviewer approves record "r-silent-tailer"
    And the reviewer finishes the review
    And the reviewer goes back to the dashboard
    Then the diary's row for retro 1 is "submitted"
    And no two retro states on the dashboard share a look
    And the browser reported no console errors

    Examples:
      | theme |
      | light |
      | dark  |

  # ── the four tiles ────────────────────────────────────────────────────────
  #
  # On crossRetro the four readings are 7, 5, 1·2 and 2 — every one of them a
  # different number from the others, and the Require human pair internally
  # different too, so a tile counting the wrong axis or the wrong half of the
  # involvement split cannot pass by landing on a coincidence.
  Scenario: The tiles read the corpus on four different axes
    Given the stage holds the retrospectives of two sessions
    And the reviewer opens the dashboard
    Then the dashboard counts 7 records
    And the dashboard counts 5 still open
    And the "Require human" tile reads 1 interactive and 2 pull request
    And the dashboard counts 2 at high severity
    And the browser reported no console errors

  # The pair is the one figure on this page that is marked up as a definition
  # list, and it used to be an inverted one: `<dd>` before `<dt>`, which is how it
  # got the value-first look and is not what a definition list means. Session 11
  # flagged it as pre-existing and load-bearing — the look is the reading — so the
  # fix had to keep the picture and correct the document.
  #
  # Both halves are asserted because either alone permits what the other catches:
  # a conforming list laid out label-first reads wrong, and a value-first picture
  # built the old way is the bug that shipped.
  Scenario: The Require human pair is a conforming definition list, read number-first
    Given the stage holds the retrospectives of two sessions
    And the reviewer opens the dashboard
    Then each count in the "Require human" tile is a term followed by its description
    And each count in the "Require human" tile shows its number above its label
    And the browser reported no console errors

  # The discrimination that matters most on these tiles: they count what is
  # **open**, not what exists. Archiving the one open SEV2 record has to move
  # three numbers three different ways — the total unchanged, still-open down
  # one, high-severity down one — which a tile counting totals cannot reproduce.
  # Every move is inside the app — the readings row in, the trail back out. The
  # typed mock's world is state in the page, so a scenario that re-opened the
  # dashboard with a fresh load would archive a record and then be shown a world
  # where it never happened.
  Scenario: The tiles count what is open, not what the store holds
    Given the reviewer opens the dashboard
    Then the dashboard counts 3 records
    And the dashboard counts 3 still open
    And the dashboard counts 2 at high severity
    When the reviewer opens readings row 1
    And the reviewer opens the resolve panel on the record page
    And the reviewer archives the record
    And the reviewer goes back to the dashboard
    Then the dashboard counts 3 records
    And the dashboard counts 2 still open
    And the dashboard counts 1 at high severity

  # ── the chart, and D6's orientation ruling ────────────────────────────────
  #
  # Four axes, and the owner ruled that every one of them draws horizontally —
  # Requester and Type used to be vertical columns. Asserted off the renderer's
  # own `data-orientation` rather than off tick coordinates: a position assertion
  # here would be measuring recharts' layout maths, which the browser does half of
  # for free and which would go green for the wrong reason when it changes.
  Scenario: The chart offers four axes and draws every one of them horizontally
    Given the stage holds the retrospectives of two sessions
    And the reviewer opens the dashboard
    Then the chart offers the axes "Severity, Solution level, Requester, Type"
    And every axis draws the chart horizontally
    And the browser reported no console errors

  # His ruling: the Retrospective axis "is useless". Absence, so it is asserted as
  # absence — and this is the scenario a plant legitimately leaves green, because
  # nothing can be removed to make an absent tab appear.
  Scenario: The Retrospective axis is not offered
    Given the stage holds the retrospectives of two sessions
    And the reviewer opens the dashboard
    Then the chart does not offer the axis "Retrospective"

  # ── the rows behind the numbers ───────────────────────────────────────────
  #
  # Four cuts since D9, named and ordered to match the tiles above them. On
  # crossRetro they count 5, 3, 2 and 2 — and Require human differing from High sev
  # is the whole reason this scenario moved off the one-retrospective fixture,
  # where both are 2 and a tab picking the wrong predicate would pass. Direction
  # 3's rule holds: a count on a labelled item renders in brackets.
  Scenario: The readings table counts its four cuts in brackets
    Given the stage holds the retrospectives of two sessions
    And the reviewer opens the dashboard
    Then the readings tabs read "Still open (5), Require human (3), High sev (2), Closed (2)"
    And the readings table lists 5 rows

  # D9's real claim: the tab and the tile are one reading, not two that happen to
  # agree today. Asserted as an equality between what the tile counts and what the
  # tab lists, so a predicate that drifted on either side fails here — which is the
  # failure that would otherwise be silent, a tab rendering perfectly good rows
  # that do not add up to the number above them.
  Scenario: The Require human tab lists exactly what its tile counts
    Given the stage holds the retrospectives of two sessions
    And the reviewer opens the dashboard
    Then the "Require human" tile reads 1 interactive and 2 pull request
    When the reviewer opens the "Require human" cut
    Then the readings table lists 3 rows
    And every row in the readings table needs a human

  Scenario: A readings row is the way to that record's own page
    Given the reviewer opens the dashboard
    When the reviewer opens readings row 1
    Then the record page shows record 1

  # ── direction 4: the diary ────────────────────────────────────────────────
  #
  # Sittings, not a flat list — grouped by the session that produced them, newest
  # sitting first, and the retrospectives inside a sitting in the order they
  # happened. crossRetro spans two sessions, which is the only shape that can
  # catch the grouping collapsing or inverting.
  Scenario: The diary groups retrospectives into the sittings that produced them
    Given the stage holds the retrospectives of two sessions
    And the reviewer opens the dashboard
    Then the diary holds 2 sittings
    And the diary's sittings are sessions "1, 2"
    And the diary lists 3 retrospectives
    And the browser reported no console errors

  # The global id, which is the whole of the second half of direction 4:
  # `retroNumber` counts per session and repeats, so on a list spanning two
  # sessions it cannot identify the row it is printed on. Retro 2 is session 1's
  # second and retro 3 is session 2's first — both "#1" or "#2" under the old
  # rule, and distinct under this one.
  Scenario: A diary row is identified by its global id, not its place in its session
    Given the stage holds the retrospectives of two sessions
    And the reviewer opens the dashboard
    Then the diary's rows are identified "Retro 1, Retro 2, Retro 3"

  # The machine-readable instant, not the rendered words — the words depend on the
  # reader's locale and on when the suite ran (see this feature's header).
  Scenario: A sitting carries the instant it started
    Given the reviewer opens the dashboard
    Then the sitting for session 1 is stamped "2026-08-24T09:00:00.000Z"

  # D5, and v2 #120 still holding: never a bare number. A retro whose latest draft
  # proposed no name reads as its GLOBAL id plus the directory it happened in.
  Scenario: A retro whose latest draft proposed no name reads as its global id
    Given the reviewer opens retro 1
    When the AI files the next revision
    And the reviewer goes back to the dashboard
    Then the diary's row for retro 1 shows the name "Retro 1 — retro"

  Scenario: A diary row is the way in, and it lands on that retrospective's review
    Given the reviewer opens the dashboard
    When the reviewer opens retro 1 from the dashboard
    Then the breadcrumb reads "Retroloop › retro › Session 1 › Retro #1 · Rev 2"
    And the review header names the retro "The lock, the arrows and the silent tailer"

  # ── the two screens this product is read on ───────────────────────────────
  #
  # ux-brief 04: the laptop and the iPad both ways up, plus the width with no
  # content of its own to show. The measure numbers are review.feature's, which is
  # what makes the owner's "the width of the home page is not consistent with the
  # width of the retro page" a thing the suite can fail on rather than something a
  # reviewer eyeballs.
  Scenario Outline: The page reads cleanly on every screen it is opened on
    Given the reviewer's screen is <width> by <height>
    And the reviewer opens the dashboard
    Then the dashboard counts 3 records
    And the band names 1 retrospective in flight
    And the page is <measure> pixels wide
    And the page does not scroll sideways
    And the browser reported no console errors

    Examples:
      | width | height | measure |
      | 1920  | 1080   | 1536    |
      | 1536  | 960    | 1536    |
      | 1440  | 900    | 1024    |
      | 1366  | 1024   | 1024    |
      | 1024  | 1366   | 1024    |
