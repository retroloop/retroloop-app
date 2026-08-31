Feature: The records page

  Every record of every retrospective, flat, with filters over it and a way to
  say what has been done about each one — the owner's session-8 ask: "I want a
  page that shows all the retro items flat with filtering … the goal is for me
  to see all the items irrespective of the session or retro or cwd in one place
  list", and "even after a retro has been closed, we should be able to attach
  metadata to issues so that we can manage their life cycle."

  These scenarios run against a stage holding three retrospectives across two
  sessions, which the review page's own fixture does not (`crossRetro` in
  test/trpc-mock.ts). That is not a re-proof of the ordering the router already
  proves: it is the only shape in which a row can be caught carrying the wrong
  retrospective's identity, linking to the wrong review, or resolving the wrong
  record — and two of those retrospectives mint the same rid on purpose, because
  a rid is minted per retrospective and (retroId, rid) is the identity (A5).

  Background:
    Given the stage holds the retrospectives of two sessions

  Scenario: Every record of every retrospective, newest retrospective first
    Given the reviewer opens the records page
    Then the records page lists 7 records
    And the records read, in order:
      | retro | rid                |
      | 3     | r-stale-lock       |
      | 3     | r-ipad-scroll      |
      | 2     | r-flaky-landing    |
      | 2     | r-export-widening  |
      | 1     | r-stale-lock       |
      | 1     | r-bullet-responses |
      | 1     | r-silent-tailer    |
    And the browser reported no console errors

  # A rid is minted per retrospective, so the same one names two different
  # records here. A page that keyed rows by rid alone renders two rows under one
  # React key and reads whichever it reached first.
  Scenario: The same rid in two retrospectives is two records
    Given the reviewer opens the records page
    Then record "r-stale-lock" of retro 1 is titled "Deploy blocked on a stale lock file"
    And record "r-stale-lock" of retro 3 is titled "The stage lock survives a crash here too"
    And the verdict on record "r-stale-lock" of retro 1 is "pending"
    And the verdict on record "r-stale-lock" of retro 3 is "revise"
    And record "r-stale-lock" of retro 1 was raised by "HUMAN"
    And record "r-stale-lock" of retro 3 was raised by "AI"

  # The one page in the product where two identity lines are on screen at once,
  # so the only one where a row can be caught rendering the page's instead of its
  # own. All three differ in both halves: the session and the ordinal.
  Scenario: A row carries its own retrospective's identity
    Given the reviewer opens the records page
    Then record "r-silent-tailer" of retro 1 shows the identity "Session 1 · Retro #1 · /Users/haider/Developer/retro"
    And record "r-export-widening" of retro 2 shows the identity "Session 1 · Retro #2 · /Users/haider/Developer/retro"
    And record "r-ipad-scroll" of retro 3 shows the identity "Session 2 · Retro #1 · /Users/haider/Developer/harbor"

  Scenario: A row says which record it is and how bad it is
    Given the reviewer opens the records page
    Then record "r-silent-tailer" of retro 1 is numbered "#3"
    And record "r-silent-tailer" of retro 1 shows the severity "SEV1"
    And record "r-ipad-scroll" of retro 3 is numbered "#7"
    And record "r-ipad-scroll" of retro 3 shows the severity "SEV4"

  # The owner: "I am noticing that records don't seem to have unique id. in each
  # retro record ids start from #1 which is weird … obviously I will like the
  # global sequence rather than this retro prefix." This is the page he saw it
  # on, and this scenario is the whole of what he asked for: seven records, seven
  # numbers, and no two rows saying the same one.
  #
  # Every pairing below disagrees with the reading it replaced. Retro 2's first
  # record is #4 and retro 3's is #6, so a per-retro number is out; both
  # r-stale-locks are their retrospective's record 1 and they are #1 and #6, so
  # keying on the rid is out.
  Scenario: The number is the record's place in the ledger, not in its retrospective
    Given the reviewer opens the records page
    Then the records are numbered, in order:
      | retro | rid                | number |
      | 3     | r-stale-lock       | #6     |
      | 3     | r-ipad-scroll      | #7     |
      | 2     | r-flaky-landing    | #4     |
      | 2     | r-export-widening  | #5     |
      | 1     | r-stale-lock       | #1     |
      | 1     | r-bullet-responses | #2     |
      | 1     | r-silent-tailer    | #3     |

  # A record filed before the multi-solution shape reads exactly like one filed
  # after it: nothing on this row comes from a solution, and both shapes have to
  # go on rendering forever.
  Scenario: A record filed in the legacy shape reads like any other
    Given the reviewer opens the records page
    Then record "r-export-widening" of retro 2 is titled "The export could carry the lifecycle entries too"
    And the verdict on record "r-export-widening" of retro 2 is "declined"
    And record "r-export-widening" of retro 2 shows the severity "SEV5"
    And record "r-export-widening" of retro 2 is "archived"

  Scenario: The counts are over every record, on all three dimensions
    Given the reviewer opens the records page
    Then the filters count:
      | filter           | count |
      | open             | 5     |
      | resolved         | 1     |
      | archived         | 1     |
      | verdict-pending  | 3     |
      | verdict-approved | 2     |
      | verdict-declined | 1     |
      | verdict-revise   | 1     |
      | requester-human  | 4     |
      | requester-ai     | 3     |

  # r-hold-semantics froze the verdict and r-remove-hold took its dead chip off
  # the review bar. The same rule applies to a filter that could only ever read
  # zero here.
  Scenario: The verdict nobody can give any more is not offered
    Given the reviewer opens the records page
    Then the filters do not offer "verdict-hold"

  Scenario: A lifecycle chip narrows to what it names, and the counts stay put
    Given the reviewer opens the records page
    When the reviewer filters to "resolved" records
    Then the records page lists 1 record
    And the records read, in order:
      | retro | rid             |
      | 2     | r-flaky-landing |
    And the filters count:
      | filter   | count |
      | open     | 5     |
      | resolved | 1     |
      | archived | 1     |

  # Composing is the whole point of three dimensions: "approved" alone is two
  # records and one of them is already fixed, so the pair answers a question
  # neither chip answers on its own.
  Scenario: The three dimensions narrow together
    Given the reviewer opens the records page
    When the reviewer filters to "open" records
    Then the records page lists 5 records
    When the reviewer filters to the verdict "approved"
    Then the records page lists 1 record
    And the records read, in order:
      | retro | rid           |
      | 3     | r-ipad-scroll |

  Scenario: The requester filter narrows on its own
    Given the reviewer opens the records page
    When the reviewer filters to the requester "ai"
    Then the records page lists 3 records
    And the records read, in order:
      | retro | rid               |
      | 3     | r-stale-lock      |
      | 2     | r-export-widening |
      | 1     | r-silent-tailer   |

  # r-empty-filter-message: "it looks like a bug that all of a sudden everything
  # vanished when actually the filtered items really don't have anything left."
  Scenario: A combination that matches nothing says so, and says how much it hid
    Given the reviewer opens the records page
    When the reviewer filters to "resolved" records
    And the reviewer filters to the requester "ai"
    Then the records page lists 0 records
    And the records page says "No records match the selected filters — 7 records are hidden"

  Scenario: What the AI resolved says so, and shows what it cited
    Given the reviewer opens the records page
    Then record "r-flaky-landing" of retro 2 is "resolved"
    And record "r-flaky-landing" of retro 2 was resolved by "AI"
    And record "r-flaky-landing" of retro 2 cites:
      | 9f3c1ab                                        |
      | https://github.com/haiderhameed/retro/pull/118 |
    And record "r-flaky-landing" of retro 2 notes "Sampled at rest; the poll moved down onto the sampling."

  # A2: references are free text, so the page asks the one question that has an
  # unambiguous answer. A commit id has nowhere to point and stays a commit id.
  Scenario: A reference that is a web address is a link, and one that is not is not
    Given the reviewer opens the records page
    Then the reference "https://github.com/haiderhameed/retro/pull/118" of record "r-flaky-landing" of retro 2 links to it
    And the reference "9f3c1ab" of record "r-flaky-landing" of retro 2 is not a link

  Scenario: The human marks a record resolved, citing what fixed it
    Given the reviewer opens the records page
    When the reviewer opens the resolve panel of record "r-silent-tailer" of retro 1
    And the reviewer cites:
      """
      4d5e6f7
      https://github.com/haiderhameed/retro/issues/91
      """
    And the reviewer notes "Caught per iteration; the page says when the stream is down."
    And the reviewer resolves it
    Then record "r-silent-tailer" of retro 1 is "resolved"
    And record "r-silent-tailer" of retro 1 was resolved by "HUMAN"
    And record "r-silent-tailer" of retro 1 cites:
      | 4d5e6f7                                          |
      | https://github.com/haiderhameed/retro/issues/91  |
    And record "r-silent-tailer" of retro 1 notes "Caught per iteration; the page says when the stream is down."
    And the filters count:
      | filter   | count |
      | open     | 4     |
      | resolved | 2     |
      | archived | 1     |

  # The evidence is the point of the feature, so the page never sends a resolve
  # without any — and a note is not evidence, which is what the middle step says.
  Scenario: A resolve cites at least one reference, or it cannot be sent
    Given the reviewer opens the records page
    When the reviewer opens the resolve panel of record "r-silent-tailer" of retro 1
    Then the resolve cannot be sent
    When the reviewer notes "It is fixed, trust me."
    Then the resolve cannot be sent
    When the reviewer cites:
      """
      4d5e6f7
      """
    Then the resolve can be sent

  # A resolve writes against the row's own retrospective. Both retros hold a
  # record called r-stale-lock, so a page sending a hardcoded retroId resolves
  # the wrong one — and says so on the wrong row.
  Scenario: A resolve lands on the row's own retrospective
    Given the reviewer opens the records page
    When the reviewer opens the resolve panel of record "r-stale-lock" of retro 3
    And the reviewer cites:
      """
      c0ffee1
      """
    And the reviewer resolves it
    Then record "r-stale-lock" of retro 3 is "resolved"
    And record "r-stale-lock" of retro 1 is "open"

  Scenario: The human takes a resolution back
    Given the reviewer opens the records page
    When the reviewer reopens record "r-flaky-landing" of retro 2
    Then record "r-flaky-landing" of retro 2 is "open"
    And record "r-flaky-landing" of retro 2 cites nothing
    And the filters count:
      | filter   | count |
      | open     | 6     |
      | resolved | 0     |
      | archived | 1     |

  # The owner: "for only the records that are marked as declined during the retro
  # and we still want to maintain its discussion … so maybe we can have a type
  # called archived". A declined record is archived from birth and NOTHING WAS
  # WRITTEN to put it there — so there is no author, no evidence block, and the
  # only act it offers is the one that brings it back.
  Scenario: A declined record is archived, and nobody archived it
    Given the reviewer opens the records page
    Then record "r-export-widening" of retro 2 is "archived"
    And the verdict on record "r-export-widening" of retro 2 is "declined"
    And record "r-export-widening" of retro 2 cites nothing
    And record "r-export-widening" of retro 2 offers only "Unarchive"

  # "by default all others that have approval, those are normal records so if a
  # user wants, they can just archive it." One press, no composer: an archive
  # cites nothing, and a note it could take is a note this page never shows back.
  Scenario: The human puts an open record out of the way
    Given the reviewer opens the records page
    Then record "r-bullet-responses" of retro 1 is "open"
    When the reviewer archives record "r-bullet-responses" of retro 1
    Then record "r-bullet-responses" of retro 1 is "archived"
    And record "r-bullet-responses" of retro 1 offers only "Unarchive"
    And the filters count:
      | filter   | count |
      | open     | 4     |
      | resolved | 1     |
      | archived | 2     |

  # A fixed record can be put away too, and its references go with it: they were
  # evidence for the resolve, not the state of a record that is out of the way.
  Scenario: Archiving a resolved record takes its evidence off the row
    Given the reviewer opens the records page
    Then record "r-flaky-landing" of retro 2 is "resolved"
    When the reviewer archives record "r-flaky-landing" of retro 2
    Then record "r-flaky-landing" of retro 2 is "archived"
    And record "r-flaky-landing" of retro 2 cites nothing

  Scenario: The human brings an archived record back
    Given the reviewer opens the records page
    When the reviewer unarchives record "r-export-widening" of retro 2
    Then record "r-export-widening" of retro 2 is "open"
    And the filters count:
      | filter   | count |
      | open     | 6     |
      | resolved | 1     |
      | archived | 0     |

  # An archived record is out of the way, not gone — the discussion is the whole
  # reason it is archived rather than deleted. So it stays on the page, and the
  # chip is what hides it. FOR HIS REVIEW: the alternative is hiding archived
  # rows by default and offering a chip to show them.
  Scenario: Archived rows stay on the page, and a chip is what hides them
    Given the reviewer opens the records page
    Then the records page lists 7 records
    When the reviewer filters to "archived" records
    Then the records page lists 1 record
    And the records read, in order:
      | retro | rid               |
      | 2     | r-export-widening |

  # Both retros hold a record called r-stale-lock, so a page sending a hardcoded
  # retroId archives the wrong one — and says so on the wrong row.
  Scenario: An archive lands on the row's own retrospective
    Given the reviewer opens the records page
    When the reviewer archives record "r-stale-lock" of retro 3
    Then record "r-stale-lock" of retro 3 is "archived"
    And record "r-stale-lock" of retro 1 is "open"

  # A9: events.onRetro is scoped to one retrospective and a flat page has nothing
  # single to subscribe to, so coming back to the tab is what catches it up —
  # which is when the AI, in its own process, has been working the fix queue.
  Scenario: The page catches up with what the AI did while the reviewer was away
    Given the reviewer opens the records page
    Then record "r-silent-tailer" of retro 1 is "open"
    When the AI resolves record "r-silent-tailer" of retro 1, citing "8e2b4c9"
    And the reviewer comes back to the tab
    Then record "r-silent-tailer" of retro 1 is "resolved"
    And record "r-silent-tailer" of retro 1 was resolved by "AI"

  # The owner, on what a row used to do: "when I go to the records page and click
  # on a record, it takes me to the retro page. each record should have it's own
  # dedicated page." So a row's one link is that page, and the way to the
  # retrospective lives on it — which reverses rulings A6/A7.
  Scenario: A row is one click to that record's own page
    Given the reviewer opens the records page
    When the reviewer opens record "r-bullet-responses" of retro 1 from the records page
    Then the breadcrumb reads "Retroloop › Records › #2"
    And the record page is numbered "#2"
    And the record page is titled "Answers come back as bullet lists when prose was asked for"

  # The URL carries the global number, which is the one name a record has that is
  # not a pair — and it is the number the row showed. Both r-stale-locks are their
  # retrospective's record 1, so a link built from the rid or from `num` opens the
  # wrong one and lands on a page that says so.
  Scenario: The row's link is the number the row shows
    Given the reviewer opens the records page
    Then record "r-stale-lock" of retro 3 is numbered "#6"
    When the reviewer opens record "r-stale-lock" of retro 3 from the records page
    Then the address is "/records/6"
    And the record page is titled "The stage lock survives a crash here too"

  # ── the record's own page ─────────────────────────────────────────────────
  #
  # "each record should have it's own dedicated page. note that all pages should
  # have consistent width and overall layout. the record page sure should give me
  # option to go to the retro page." Everything below runs on the same
  # three-retrospective stage, which is what makes "its own" falsifiable: two of
  # them mint the same rid, and a page reading the wrong half of the pair renders
  # the other record's narrative under this record's number.

  Scenario: The record page carries the record, whole
    Given the reviewer opens record 3 directly
    Then the record page is numbered "#3"
    And the record page is titled "The tailer stops without saying so"
    And the record page is typed "issue"
    And the record page was raised by "AI"
    And the verdict on the record page is "pending"
    And the record page is "open"
    And the record page reads the problem "When the poll loop throws, the loop ends and every open page simply stops receiving events. Nothing logs, and the pages look merely quiet."
    And the record page shows the sections:
      | problem     |
      | human_words |
      | root_cause  |
      | workaround  |
      | direction   |
      | footprint   |
    And the browser reported no console errors

  # A record filed in the shape the owner asked for renders the other branch, and
  # the tick is the verdict's own selection rather than a choice offered here.
  Scenario: A record that proposes solutions shows them, and offers no choice
    Given the reviewer opens record 6 directly
    Then the record page shows the sections:
      | problem     |
      | human_words |
      | root_cause  |
      | workaround  |
      | solutions   |
    And the record page offers no way to select a solution

  # "let's leave out the comments for now" — and a verdict is given inside its
  # review, against a revision the reviewer chose, so neither is on this page.
  Scenario: The page offers no comments and no verdict
    Given the reviewer opens record 3 directly
    Then the record page offers no way to comment
    And the record page offers no verdict controls

  Scenario: The record page states its own retrospective's identity line
    Given the reviewer opens record 7 directly
    Then the record page shows the identity "Session 2 · Retro #1 · /Users/haider/Developer/harbor"

  # "the record page sure should give me option to go to the retro page" — and it
  # lands *at the record*, which is the anchor the flat page's rows used to carry.
  Scenario: The record page is the way to its own retrospective
    Given the reviewer opens the records page
    When the reviewer opens record "r-ipad-scroll" of retro 3 from the records page
    And the reviewer follows the link to the retrospective
    Then the breadcrumb reads "Retroloop › Session 2 › Retro #1 · Rev 1"
    And the viewport lands on record "r-ipad-scroll"

  # One number per record, from the row to its page to the review it came from.
  # Retro 3 is not the world's first, which is the only arrangement in which a
  # record's number and its per-retro `num` differ — its two records are still
  # its records 1 and 2.
  Scenario: A record keeps its number from the row to its page to its review
    Given the reviewer opens the records page
    Then record "r-ipad-scroll" of retro 3 is numbered "#7"
    When the reviewer opens record "r-ipad-scroll" of retro 3 from the records page
    Then the record page is numbered "#7"
    When the reviewer follows the link to the retrospective
    Then the record index entry for "r-stale-lock" reads "#6" and "The stage lock survives a crash here too"
    And the record index entry for "r-ipad-scroll" reads "#7" and "The reading column scrolls sideways on the iPad"
    And record "r-ipad-scroll" is numbered "#7"

  # The breadcrumb is the way back to the list the reader came from, and it works
  # on a page opened cold as well as one arrived at.
  Scenario: The breadcrumb leads back to the records page
    Given the reviewer opens record 4 directly
    Then the breadcrumb reads "Retroloop › Records › #4"
    When the reviewer follows the records crumb
    Then the records page lists 7 records

  Scenario: A number nothing was minted for is not found
    Given the reviewer opens "/records/404"
    Then the page says it cannot find that

  # ux-brief 03: an id that is not an integer is not a request for a record, and
  # the page says so without asking the server.
  Scenario: A record id that is not an integer is not found
    Given the reviewer opens "/records/nope"
    Then the page says it cannot find that

  # ── the lifecycle, from the record's own page ─────────────────────────────
  #
  # The same acts the row offers, addressed to the same (retroId, rid) — and the
  # page is on a record of retro 3, which is not the world's first, so a write
  # that sent a hardcoded retrospective lands on the wrong record.

  Scenario: The human marks a record resolved from its own page
    Given the reviewer opens record 7 directly
    Then the record page is "open"
    When the reviewer opens the resolve panel on the record page
    And the reviewer cites:
      """
      c0ffee1
      https://github.com/haiderhameed/retro/pull/204
      """
    And the reviewer notes "min-w-0 on the column, overflow-x-auto on the box."
    And the reviewer resolves it
    Then the record page is "resolved"
    And the record page was resolved by "HUMAN"
    And the record page cites:
      | c0ffee1                                        |
      | https://github.com/haiderhameed/retro/pull/204 |

  Scenario: A resolve from the record page lands on that record and no other
    Given the reviewer opens record 6 directly
    When the reviewer opens the resolve panel on the record page
    And the reviewer cites:
      """
      c0ffee1
      """
    And the reviewer resolves it
    Then the record page is "resolved"
    When the reviewer opens record 1 directly
    Then the record page is "open"

  Scenario: The human puts a record out of the way and brings it back
    Given the reviewer opens record 2 directly
    Then the record page is "open"
    When the reviewer archives the record
    Then the record page is "archived"
    And the record page offers only "Unarchive"
    When the reviewer unarchives the record
    Then the record page is "open"

  # A declined record is archived from birth and nobody archived it, so there is
  # no author, no evidence block, and one act on offer.
  Scenario: A declined record is archived on its own page too
    Given the reviewer opens record 5 directly
    Then the verdict on the record page is "declined"
    And the record page is "archived"
    And the record page cites nothing
    And the record page offers only "Unarchive"

  # ── relations ─────────────────────────────────────────────────────────────
  #
  # "Both actors can relate records, each relation carries how-they-relate words,
  # and the relation reads from both sides, so that AI can easily find past
  # records and build holistic solutions."
  #
  # The world opens holding one relation, written by the AI — which is the actor
  # the feature was asked for, and one the browser could never impersonate: its
  # context is `human` unconditionally, so an AI-authored relation is a thing a
  # scenario can only read.

  # One stored row, two pages. The direction is the only thing that differs, and
  # each page names the *other* record — which is what makes a page that keyed
  # the row by its own end render nothing on one of the two.
  Scenario: A relation the AI wrote reads from both records' pages
    Given the reviewer opens record 3 directly
    Then the record page's relations read:
      | direction | record | how                                            | title                               | who |
      | outgoing  | 1      | the same swallowed error, one loop further out | Deploy blocked on a stale lock file | AI  |
    When the reviewer opens record 1 directly
    Then the record page's relations read:
      | direction | record | how                                            | title                            | who |
      | incoming  | 3      | the same swallowed error, one loop further out | The tailer stops without saying so | AI  |
    And the browser reported no console errors

  Scenario: A relation is one click to the record at the other end
    Given the reviewer opens record 3 directly
    When the reviewer follows the outgoing relation to record 1
    Then the address is "/records/1"
    And the record page is titled "Deploy blocked on a stale lock file"

  # The human's half of the same table, from the browser — and it lands on both
  # pages exactly as the AI's did.
  Scenario: The human relates two records, and both pages carry it
    Given the reviewer opens record 2 directly
    Then the record page relates to nothing
    When the reviewer opens the relate panel
    And the reviewer names record 1
    And the reviewer says they relate by "the same lock, from the other end"
    And the reviewer relates them
    Then the record page's relations read:
      | direction | record | how                               | title                               | who   |
      | outgoing  | 1      | the same lock, from the other end | Deploy blocked on a stale lock file | HUMAN |
    When the reviewer follows the outgoing relation to record 1
    Then the record page's relations read:
      | direction | record | how                                            | title                                                      | who   |
      | incoming  | 3      | the same swallowed error, one loop further out | The tailer stops without saying so                         | AI    |
      | incoming  | 2      | the same lock, from the other end              | Answers come back as bullet lists when prose was asked for | HUMAN |

  # **The case the feature exists for.** Record 6 is in retro 3, whose review
  # closed; relating a record of retro 1 to it is exactly "find past records",
  # and a lock over a finished retrospective would make it unreachable.
  Scenario: A relation crosses retrospectives, one of them closed
    Given the reviewer opens record 3 directly
    When the reviewer opens the relate panel
    And the reviewer names record 6
    And the reviewer says they relate by "the same lock, three retros later"
    And the reviewer relates them
    Then the record page's relations read:
      | direction | record | how                                            | title                                   | who   |
      | outgoing  | 1      | the same swallowed error, one loop further out | Deploy blocked on a stale lock file     | AI    |
      | outgoing  | 6      | the same lock, three retros later               | The stage lock survives a crash here too | HUMAN |
    When the reviewer follows the outgoing relation to record 6
    Then the record page's relations read:
      | direction | record | how                              | title                              | who   |
      | incoming  | 3      | the same lock, three retros later | The tailer stops without saying so | HUMAN |
    And the browser reported no console errors

  # Un-relating is a row and not a delete, but what a reader sees is the line
  # going — from both pages, because there was only ever one row.
  #
  # The far page is reached through the crumb rather than by address: a fresh
  # address is a fresh world (the mock is a module, and a reload re-runs it), so
  # a scenario that wrote something has to stay inside the app to read it back.
  Scenario: Un-relating takes the line off both pages
    Given the reviewer opens record 3 directly
    When the reviewer un-relates the outgoing relation to record 1
    Then the record page relates to nothing
    When the reviewer follows the records crumb
    And the reviewer opens record "r-stale-lock" of retro 1 from the records page
    Then the record page relates to nothing

  # The far page is the one that can un-relate what it did not write, and the
  # write has to name the pair the way it was stored or it names nothing: an
  # incoming relation is `(that record, this one)` and sending it the other way
  # round is a pair that does not stand.
  Scenario: An incoming relation can be taken off from the page it points at
    Given the reviewer opens record 3 directly
    When the reviewer follows the outgoing relation to record 1
    And the reviewer un-relates the incoming relation to record 3
    Then the record page relates to nothing
    When the reviewer follows the records crumb
    And the reviewer opens record "r-silent-tailer" of retro 1 from the records page
    Then the record page relates to nothing

  # The two halves of the act, and the page never sends without both — the same
  # guard the resolve composer puts on its own submit, and the only refusal this
  # panel expresses itself.
  Scenario: A relation needs a record and words, or it cannot be sent
    Given the reviewer opens record 2 directly
    When the reviewer opens the relate panel
    Then the relation cannot be sent
    When the reviewer names record 1
    Then the relation cannot be sent
    When the reviewer says they relate by "duplicates"
    Then the relation can be sent

  # Everything past those two is the server's sentence, shown verbatim: a page
  # that restated the domain's rules would be a second copy free to disagree
  # with the CLI's.
  Scenario: A record related to itself is refused, in the server's own words
    Given the reviewer opens record 2 directly
    When the reviewer opens the relate panel
    And the reviewer names record 2
    And the reviewer says they relate by "itself"
    And the reviewer relates them
    Then relating is refused with "cannot be related to itself"
    And the record page relates to nothing

  Scenario: A number nothing was minted for is refused
    Given the reviewer opens record 2 directly
    When the reviewer opens the relate panel
    And the reviewer names record 404
    And the reviewer says they relate by "nowhere"
    And the reviewer relates them
    Then relating is refused with "No record with id 404"

  Scenario: Relating a pair that already stands is refused
    Given the reviewer opens record 3 directly
    When the reviewer opens the relate panel
    And the reviewer names record 1
    And the reviewer says they relate by "again"
    And the reviewer relates them
    Then relating is refused with "already related"

  # The timeline's contract is three kinds and no fourth. A relation is a
  # statement about two records rather than something that happened to one, and a
  # reader of either can already see it in the block above.
  Scenario: A relation adds nothing to the timeline
    Given the reviewer opens record 4 directly
    When the reviewer opens the relate panel
    And the reviewer names record 1
    And the reviewer says they relate by "duplicates"
    And the reviewer relates them
    Then the record page's relations read:
      | direction | record | how        | title                               | who   |
      | outgoing  | 1      | duplicates | Deploy blocked on a stale lock file | HUMAN |
    And the record's timeline reads:
      | actor | what                       |
      | AI    | Filed in revision 1        |
      | HUMAN | Approved against revision 1 |
      | AI    | Resolved                   |

  # **The order is the row in force, not when the pair was first written** — so
  # an act on an old relation moves it to the end, and a fold that handed back
  # its map's insertion order would keep the old pair first forever.
  #
  # Invisible to everything but a reading like this one: an array of the right
  # shape in the wrong order satisfies the output schema and the parity check
  # exactly as well as one in the right order. The server's half of this claim is
  # pinned in `apps/api/test/procedures.test.ts` on the same sequence of acts.
  Scenario: A re-related pair moves to the end of the list
    Given the reviewer opens record 1 directly
    When the reviewer opens the relate panel
    And the reviewer names record 2
    And the reviewer says they relate by "and this one came after"
    And the reviewer relates them
    Then the record page's relations read:
      | direction | record | how                                            | title                                                      | who   |
      | incoming  | 3      | the same swallowed error, one loop further out | The tailer stops without saying so                         | AI    |
      | outgoing  | 2      | and this one came after                        | Answers come back as bullet lists when prose was asked for | HUMAN |
    When the reviewer un-relates the incoming relation to record 3
    And the reviewer follows the records crumb
    And the reviewer opens record "r-silent-tailer" of retro 1 from the records page
    And the reviewer opens the relate panel
    And the reviewer names record 1
    And the reviewer says they relate by "and it turned out to be the same one after all"
    And the reviewer relates them
    And the reviewer follows the outgoing relation to record 1
    Then the record page's relations read:
      | direction | record | how                                          | title                                                      | who   |
      | outgoing  | 2      | and this one came after                      | Answers come back as bullet lists when prose was asked for | HUMAN |
      | incoming  | 3      | and it turned out to be the same one after all | The tailer stops without saying so                       | HUMAN |

  # ux-brief 04's standing limit on the widest line this block can hold: a title
  # from another retrospective, free-text words and a link, all on one row.
  Scenario Outline: A relation reads cleanly on every screen it is opened on
    Given the reviewer's screen is <width> by <height>
    And the reviewer opens record 3 directly
    Then the record page's relations read:
      | direction | record | how                                            | title                               | who |
      | outgoing  | 1      | the same swallowed error, one loop further out | Deploy blocked on a stale lock file | AI  |
    And the page is <measure> pixels wide
    And the page does not scroll sideways
    And the browser reported no console errors

    Examples:
      | width | height | measure |
      | 1536  | 960    | 1536    |
      | 1024  | 1366   | 1024    |

  # ── the timeline ──────────────────────────────────────────────────────────
  #
  # "We can have a timeline at the bottom that shows how the record evolved.
  # timeline can have events like status changes." Comments are out by his later
  # word.

  # A record nobody has decided or touched still has the one event every record
  # has: the draft the AI filed it in.
  Scenario: A record that has only been filed says so, and says which draft
    Given the reviewer opens record 3 directly
    Then the record's timeline reads:
      | actor | what                  |
      | AI    | Filed in revision 1   |

  # A record the AI introduced in a later draft was created then, not at revision
  # 1 — the fixture's one-solution record arrives with revision 3.
  Scenario: A record filed in a later draft says which draft that was
    Given the reviewer opens record 3 directly
    When the AI files the next revision
    And the reviewer follows the records crumb
    And the reviewer opens record "r-doctor-blind" of retro 1 from the records page
    Then the record page is numbered "#8"
    And the record's timeline reads:
      | actor | what                |
      | AI    | Filed in revision 3 |

  # The three kinds on one list, in the order they happened: the draft, the
  # verdict the review closed on, and what the AI did about it afterwards.
  Scenario: The timeline shows the filing, the verdict and the fix, in that order
    Given the reviewer opens record 4 directly
    Then the record's timeline reads:
      | actor | what                       |
      | AI    | Filed in revision 1        |
      | HUMAN | Approved against revision 1 |
      | AI    | Resolved                   |
    And each timeline entry is later than the one before it

  # An act taken back is still an act taken: the table is append-only, so
  # reopening adds a line rather than removing the resolve's.
  Scenario: Taking a resolution back adds a line rather than removing one
    Given the reviewer opens record 4 directly
    When the reviewer reopens the record
    Then the record's timeline reads:
      | actor | what                       |
      | AI    | Filed in revision 1        |
      | HUMAN | Approved against revision 1 |
      | AI    | Resolved                   |
      | HUMAN | Reopened                   |

  # The references the resolve cited, on the line that cited them — and the same
  # one question the records page asks of a reference (A2).
  Scenario: A resolve on the timeline carries what it cited, linked only when it is a link
    Given the reviewer opens record 4 directly
    Then the timeline cites:
      | 9f3c1ab                                        |
      | https://github.com/haiderhameed/retro/pull/118 |
    And the timeline reference "https://github.com/haiderhameed/retro/pull/118" links to it
    And the timeline reference "9f3c1ab" is not a link
    And the timeline notes "Sampled at rest; the poll moved down onto the sampling."

  # A record whose verdict was given and then taken somewhere else keeps both, in
  # the order they were given — the effective verdict says where it stands, and
  # the timeline says how it got there.
  Scenario: Every verdict stays on the timeline, not only the one in force
    Given the reviewer opens record 1 directly
    When the reviewer follows the link to the retrospective
    And the reviewer approves record "r-stale-lock"
    Then record "r-stale-lock" is "approved"
    When the reviewer declines record "r-stale-lock"
    Then record "r-stale-lock" is "declined"
    When the reviewer goes back to the record page
    Then the verdict on the record page is "declined"
    And the record's timeline reads:
      | actor | what                        |
      | AI    | Filed in revision 1         |
      | HUMAN | Approved against revision 2 |
      | HUMAN | Declined against revision 2 |

  # The page catches up with what the AI did in its own process, on the one
  # signal it has (A9): coming back to the tab.
  Scenario: The record page catches up with what the AI did while the reviewer was away
    Given the reviewer opens record 3 directly
    Then the record page is "open"
    When the AI resolves record "r-silent-tailer" of retro 1, citing "8e2b4c9"
    And the reviewer comes back to the tab
    Then the record page is "resolved"
    And the record page was resolved by "AI"
    And the record's timeline reads:
      | actor | what                |
      | AI    | Filed in revision 1 |
      | AI    | Resolved            |

  # ux-brief 04's standing limit, on the two screens this product is read on. A
  # record page carries the widest content there is — an author-aligned footprint
  # and a pull-request URL — and it is born on the layout lane's own measure.
  Scenario Outline: The record page reads cleanly on every screen it is opened on
    Given the reviewer's screen is <width> by <height>
    And the reviewer opens record 4 directly
    Then the timeline cites:
      | 9f3c1ab                                        |
      | https://github.com/haiderhameed/retro/pull/118 |
    And the page is <measure> pixels wide
    And the page does not scroll sideways
    And the browser reported no console errors

    Examples:
      | width | height | measure |
      | 1536  | 960    | 1536    |
      | 1440  | 900    | 1024    |
      | 1024  | 1366   | 1024    |

  # A7: one way in, and since r-menu-dropdown it is an item of the one menu the
  # chrome carries rather than a link the dashboard hangs in its header.
  Scenario: The dashboard is the way in
    Given the reviewer opens the dashboard
    When the reviewer opens the app menu
    And the reviewer follows "Records" in the app menu
    Then the breadcrumb reads "Retroloop › Records"
    And the records page lists 7 records

  # The other way in is an address, and the dashboard's tiles write one: a tile
  # links here already narrowed to the cut it counted, and the chip says so.
  Scenario: A lifecycle in the address opens the page already narrowed, with the chip pressed
    Given the reviewer opens "/records?lifecycle=open"
    Then the records page lists 5 records
    And the "open" lifecycle chip is pressed

  # retro-13 r-validatesearch-narrows-not-polices, first witness, measured on
  # merged main: `?lifecycle=nonsense` rendered 0 of 132 records with no chip
  # pressed — the junk reached the filter even though the route's validator
  # returns {} for it, because `validateSearch` narrows the TYPE and does not
  # police the VALUE.
  #
  # It is the emptiness that made it worth fixing rather than the typo: a page
  # showing none of its corpus with nothing pressed to explain why reads as a
  # product that lost its records. Policed where the seed is used, an
  # unrecognised lifecycle is no lifecycle at all — which is this pair of
  # assertions, and they are the pre-specified ones from the lane that found it.
  Scenario: A lifecycle nobody defined leaves the corpus whole
    Given the reviewer opens "/records?lifecycle=nonsense"
    Then the records page lists 7 records
    And no lifecycle chip is pressed
    And the browser reported no console errors

  # r-untested-rendered-branch: the quiet line an empty product lands on is the
  # first thing anyone ever sees of it, and it is not the emptied-filter message —
  # emptiness the filters did not cause is not emptiness they can explain.
  Scenario: A fresh install says the one true thing and stops
    Given the AI has never filed a revision
    And the reviewer opens the records page of a fresh install
    Then the records page says "No records yet. They land here as the AI files retrospectives."

  # r-theme-blind-assertions: both themes, one channel at a time, because a dark
  # override that suppresses one channel leaves the others standing and a joined
  # assertion passes on the strength of whichever survived.
  Scenario Outline: The lifecycle chip that is on stands out from the one that is off
    Given the reviewer opens the records page
    And the reviewer has set dark mode to "<theme>"
    When the reviewer filters to "resolved" records
    Then the pressed lifecycle chip stands out from the unpressed ones
    And the browser reported no console errors

    Examples:
      | theme |
      | light |
      | dark  |

  # ux-brief 04's standing limit, on the two screens this product is read on. The
  # pressure is real: a row carries a full working directory and a resolved one
  # carries a pull-request URL, and neither has a space to break at.
  Scenario Outline: The page reads cleanly on every screen it is opened on
    Given the reviewer's screen is <width> by <height>
    And the reviewer opens the records page
    Then record "r-flaky-landing" of retro 2 cites:
      | 9f3c1ab                                        |
      | https://github.com/haiderhameed/retro/pull/118 |
    And record "r-ipad-scroll" of retro 3 shows the identity "Session 2 · Retro #1 · /Users/haider/Developer/harbor"
    And the page is <measure> pixels wide
    And the page does not scroll sideways
    And the browser reported no console errors

    Examples:
      | width | height | measure |
      | 1536  | 960    | 1536    |
      | 1440  | 900    | 1024    |
      | 1024  | 1366   | 1024    |
