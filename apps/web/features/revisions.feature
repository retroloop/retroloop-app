Feature: Revisions arriving under a reviewer

  The AI files revisions while a human is reading one. The page announces them
  and does not move (KC-0005), because a verdict has to bind to the content the
  reviewer actually read — and when they do move, a decision follows the content
  it was given for (D2 carry-over).

  Scenario: A new revision is announced, and nothing on the page moves
    Given the reviewer opens retro 1
    When the AI files the next revision
    Then the banner announces revision 3
    And the breadcrumb reads "Retroloop › retro › Session 1 › Retro #1 · Rev 2"
    And record "r-silent-tailer" shows "the pages look merely quiet"

  Scenario: The page moves when the reviewer says so
    Given the reviewer opens retro 1
    When the AI files the next revision
    And the reviewer loads the announced revision
    Then there is no revision banner
    And the breadcrumb reads "Retroloop › retro › Session 1 › Retro #1 · Rev 3"
    And record "r-silent-tailer" shows "a dead stream and a quiet afternoon look the same"

  # The retro's name is the latest revision's, so a draft that proposes none
  # takes the name away — and that is a move on the page like any other: it
  # happens when the reviewer takes the revision, never while they are reading.
  Scenario: The retro is renamed when the reviewer takes the revision, not when it is filed
    Given the reviewer opens retro 1
    When the AI files the next revision
    Then the banner announces revision 3
    And the review header names the retro "The lock, the arrows and the silent tailer"
    When the reviewer loads the announced revision
    Then the review header names the retro "Retro 1 — retro"

  Scenario: An unchanged record keeps its verdict and says which revision gave it
    Given the reviewer opens retro 1
    When the reviewer approves record "r-stale-lock"
    And the AI files the next revision
    And the reviewer loads the announced revision
    Then record "r-stale-lock" is "approved"
    And record "r-stale-lock" shows the marker "decided on rev 2"

  Scenario: A record whose narrative changed is pending again
    Given the reviewer opens retro 1
    When the reviewer approves record "r-silent-tailer"
    And the AI files the next revision
    And the reviewer loads the announced revision
    Then record "r-silent-tailer" is "pending"
    # Four, not three: revision 3 brings a record the round before did not have
    # (`r-doctor-blind`, the fixture's one-solution record).
    And the filter counts read:
      | pending | 4 |

  # The reply lands in the comments panel, which is where every comment on the
  # retrospective is read since session 7 — and behind the reply count the panel
  # keeps replies behind, so the open is part of the scenario rather than an
  # implementation detail of the step.
  Scenario: An AI reply arrives in a thread the reviewer is reading
    Given the reviewer opens retro 1
    When the AI replies "Narrowed it in revision 3." on record "r-bullet-responses"
    And the reviewer opens the replies in the "direction" thread of record "r-bullet-responses"
    Then the "direction" thread of record "r-bullet-responses" shows "Narrowed it in revision 3."
    # Written from the AI's own process against the latest revision, beside the
    # two that were written against the first — the whole of "comments show the
    # rev number they are associated with, but show across all revisions".
    And the "direction" thread of record "r-bullet-responses" carries revisions "rev 1, rev 1, rev 2"

  # A pinned older revision is history, and read-only means read-only: there is
  # no control on the card that a pinned revision still takes. The hold control
  # was the one exception for a session, and retro 4 `r-remove-hold` removed it.
  Scenario: An older revision is pinned by URL and is read-only
    Given the reviewer opens retro 1 pinned to revision 1
    Then the breadcrumb reads "Retroloop › retro › Session 1 › Retro #1 · Rev 1"
    And record "r-bullet-responses" shows "The reader has to reassemble the sentence"
    And record "r-bullet-responses" offers no decision buttons
    And the review is read-only

  # The other end of the same address, and the second witness of retro-13
  # r-validatesearch-narrows-not-polices: `?rev=abc` is not a revision, and the
  # validator omitting the key is NOT what decides that. TanStack Router's
  # `validateSearch` narrows the type and hands the raw search back, so until the
  # guard moved to the point of use this address pinned the review to the string
  # "abc" — the store was asked for records under it and answered none, the
  # breadcrumb read "Rev abc", and the round came back read-only because the
  # comparison that decides that was never asked of a string.
  #
  # What a mistyped address should do is what a bare one does, which is why every
  # assertion here is the unpinned page's: a URL a human edited by hand lands on
  # the newest revision, editable, with its records under it.
  Scenario: A revision that is not a number is not a pin, and the review opens on the newest
    Given the reviewer opens "/retros/1?rev=abc"
    Then the breadcrumb reads "Retroloop › retro › Session 1 › Retro #1 · Rev 2"
    And record "r-silent-tailer" shows "the pages look merely quiet"
    And the review is not read-only
    And the browser reported no console errors
