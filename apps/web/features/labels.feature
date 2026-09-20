Feature: Labels, attributes and the settings page

  Labels and attributes are both pure: a label is a name a record wears, with
  no payload, and an attribute carries data beside it — for example an
  attribute could hold a Jira ticket or an external ticket id, typed as a
  number when that is how it is defined. Composing the two is the user's
  convention and never a system mechanism, so nothing below ever checks that
  a labelled record carries a value.

  Adding labels or attributes requires a settings page, because each label
  or attribute is a global thing. That page is what the first half of this
  file is about, and its one switch is a toggle the user can enable to give
  the AI the ability to update the configs; when it is disabled, the user
  can be certain the AI cannot touch them.

  What these scenarios can prove is what a browser can prove — that the page
  reads the store, writes to it, and offers only what the store would accept.
  The certainty itself is enforced below every adapter, and is proved there
  (packages/core/test/unit/settings.test.ts): the browser's actor is `human`
  unconditionally, so no click on this page could ever be refused by the guard
  the switch governs.

  The stage holds three retrospectives across two sessions, like the records
  page's own scenarios, and the vocabulary a human configured before any of this
  started: `migrated`, `needs triage`, a retired `wontfix`, and three attributes
  of three different types with one of them retired.

  Background:
    Given the stage holds the retrospectives of two sessions

  # ── the settings page ─────────────────────────────────────────────────────

  # The settings page uses a standing list of section names down the left, built
  # with shadcn's vertical tabs: the current section highlighted, one panel
  # beside it — and the counted chip row an earlier version shipped with is gone.
  #
  # The order matters too: General is the first item in the list, and Appearance
  # is another tab of its own alongside it. So: General, Appearance, Labels,
  # Attributes — asserted as a sequence rather than one item at a time, because
  # "General is first" is a claim about the order and an assertion per item would
  # pass on a list that held them in any order at all.
  #
  # The panels not open are asserted absent rather than merely invisible: that is
  # what makes these sections instead of four blocks with three of them hidden,
  # and a CSS-hidden panel would leave every one of its controls in the
  # accessibility tree.
  Scenario: The sections are a vertical list, General first, and only one panel is mounted
    Given the reviewer opens the settings page
    Then the settings sections read, in order:
      | General        |
      | Appearance     |
      | Labels (3)     |
      | Attributes (3) |
    And the settings nav is vertical
    And the "general" settings section is selected
    And the "ai-config-write" settings panel is showing
    And the "labels" settings panel is not showing
    And the "attributes" settings panel is not showing
    And the "appearance" settings panel is not showing
    When the reviewer opens the "labels" settings section
    Then the "labels" settings panel is showing
    And the "ai-config-write" settings panel is not showing
    And the labels read:
      | migrated     |
      | needs triage |
      | wontfix      |
    When the reviewer opens the "attributes" settings section
    Then the "attributes" settings panel is showing
    And the "labels" settings panel is not showing
    And the attributes read:
      | external issue id | url    |
      | moved on          | date   |
      | story points      | number |
    When the reviewer opens the "appearance" settings section
    Then the "appearance" settings panel is showing
    And the "attributes" settings panel is not showing
    And the browser reported no console errors

  # A count on a labelled section renders in brackets, like "Labels (1)" instead
  # of "Labels 1". The nav item is asserted as one literal — name, space,
  # bracketed number — because that is the rule, and an assertion that read
  # the number alone would pass on the bare "Labels 3" this replaced.
  #
  # Both counts in one step, because the claim is that each section counts ITS
  # OWN vocabulary: creating a label moves one of them and must not move the
  # other, which is what tells a nav that counts the label list twice from one
  # that counts correctly.
  Scenario: A section says how much is behind it, with the count in brackets
    Given the reviewer opens the settings page
    Then the settings sections read:
      | labels     | Labels (3)     |
      | attributes | Attributes (3) |
    When the reviewer opens the "labels" settings section
    And the reviewer creates the label "needs a decision"
    Then the settings sections read:
      | labels     | Labels (4)     |
      | attributes | Attributes (3) |

  # The highlight is the mechanism of the design — a left vertical nav of
  # sections, selected item highlighted — and it is a visual state a theme
  # can change, so it is asserted in light AND dark, one channel at a time. A
  # joined comparison passes on the strength of whichever channel survived a
  # dark override and cannot say which one carried the difference.
  Scenario Outline: The selected section is visibly the selected one, in either theme
    Given the reviewer opens the settings page
    When the reviewer opens the "appearance" settings section
    And the reviewer sets dark mode to "<theme>"
    Then the selected settings section stands out from the others
    And the browser reported no console errors

    Examples:
      | theme |
      | light |
      | dark  |

  # ── Appearance ────────────────────────────────────────────────────────────

  # The dark-mode setting lives under Settings > Appearance > Dark Mode, and
  # by default it uses System mode.
  #
  # System is asserted as the value the control OPENS on, which is the half of
  # the rule a control that merely offered the option would satisfy without
  # honouring. The header toggle that used to sit beside it is gone — the top
  # navigation dropped it when it moved under one menu — so this is the only
  # control in the product that changes the theme, and the walk every other
  # feature's theme step now takes ends here (chrome.feature).
  Scenario: Dark Mode lives under Appearance and starts on System
    Given the reviewer opens the settings page
    When the reviewer opens the "appearance" settings section
    Then the dark mode setting reads "System"
    And the page is in the "light" theme
    When the reviewer sets dark mode to "Dark"
    Then the page is in the "dark" theme
    And the dark mode setting reads "Dark"
    When the page is reloaded
    Then the page is in the "dark" theme
    When the reviewer opens the "appearance" settings section
    Then the dark mode setting reads "Dark"
    And the browser reported no console errors

  # Retiring is not deleting: the row stays, the name stays readable on every
  # record that wears it, and what stops is the offering. So a retired row keeps
  # its rename, loses the act that has nothing left to do, and gains the one that
  # undoes it.
  Scenario: A retired definition stays on the list, marked, and offers un-retire instead of retire
    Given the reviewer opens the settings page
    When the reviewer opens the "labels" settings section
    Then the label "wontfix" is marked retired
    And the label "wontfix" offers no way to retire it
    And the label "wontfix" offers a way to un-retire it
    And the label "wontfix" can still be renamed
    And the label "migrated" is not marked retired
    And the label "migrated" offers no way to un-retire it

  # A retired definition can be brought back to offerable by the human — same
  # row, same one-press shape, no history rewritten, the name never freed either
  # way.
  #
  # The round trip is asserted in both directions on one row, because the claim
  # is that the two acts are inverses: retire then un-retire has to leave the row
  # exactly as it started, marked in neither direction, offering Retire again.
  Scenario: A mis-pressed retire is two presses to undo, not a burned word
    Given the reviewer opens the settings page
    When the reviewer opens the "labels" settings section
    And the reviewer retires the label "needs triage"
    Then the label "needs triage" is marked retired
    And the label "needs triage" offers a way to un-retire it
    When the reviewer un-retires the label "needs triage"
    Then the label "needs triage" is not marked retired
    And the label "needs triage" offers no way to un-retire it
    And the label "needs triage" offers a way to retire it
    # The list is the same length it was: un-retiring restored a row, it did not
    # mint one, so nothing here is a second definition wearing the same word.
    And the labels read:
      | migrated     |
      | needs triage |
      | wontfix      |

  # Both kinds — un-retire applies to BOTH definition kinds — and the attribute
  # half carries the difference that matters: the type comes back with it,
  # because there is no retype anywhere and a definition that returned without
  # its type would be claiming something its own stored values do not satisfy.
  Scenario: An attribute comes back with the type it was created with
    Given the reviewer opens the settings page
    When the reviewer opens the "attributes" settings section
    Then the attribute "story points" is marked retired
    When the reviewer un-retires the attribute "story points"
    Then the attribute "story points" is not marked retired
    And the attributes read:
      | external issue id | url    |
      | moved on          | date   |
      | story points      | number |

  # That an un-retired label is offered to a record again is the SERVER's
  # property and is proved against the real router
  # (apps/api/test/procedures.test.ts): the mock's world lives as long as the
  # module, so a scenario walking from the settings page to a record page would
  # be asserting against a second, opening world.

  Scenario: The human creates a label
    Given the reviewer opens the settings page
    When the reviewer opens the "labels" settings section
    And the reviewer creates the label "needs a decision"
    Then the labels read:
      | migrated         |
      | needs triage     |
      | wontfix          |
      | needs a decision |

  # A type is chosen once and never again — there is no control anywhere that
  # changes one, because every value already stored was accepted under it.
  Scenario: The human creates an attribute with a type
    Given the reviewer opens the settings page
    When the reviewer opens the "attributes" settings section
    And the reviewer creates the attribute "shipped in" of type "date"
    Then the attributes read:
      | external issue id | url    |
      | moved on          | date   |
      | story points      | number |
      | shipped in        | date   |

  # A rename writes over the definition rather than versioning it, which is what
  # makes a definition configuration rather than human data. That every record
  # wearing it reads the new name at once is the server's property, proved
  # against the real router; what a browser proves is that the page sends the
  # rename and reads the list back.
  Scenario: The human renames a label
    Given the reviewer opens the settings page
    When the reviewer opens the "labels" settings section
    And the reviewer renames the label "migrated" to "moved to github"
    Then the labels read:
      | moved to github |
      | needs triage    |
      | wontfix         |

  Scenario: The human retires a label
    Given the reviewer opens the settings page
    When the reviewer opens the "labels" settings section
    And the reviewer retires the label "needs triage"
    Then the label "needs triage" is marked retired
    And the label "needs triage" offers no way to retire it

  # A retired label is not offered to a record that does not wear it — which is
  # the whole of what retiring does, seen from the other end. That the rename and
  # the retire reach every record at once is the *server's* property and is
  # proved against the real router (apps/api/test/procedures.test.ts): the mock's
  # world lives as long as the module, so a scenario that walked from the
  # settings page to a record page by reloading would be asserting against a
  # second, opening world.
  Scenario: A retired label is not offered to a record that does not wear it
    Given the reviewer opens record 3 directly
    Then the record page does not offer the label "wontfix"
    And the record page offers the label "migrated"

  # The name rules are the domain's and this page deliberately does not restate
  # them — so the one thing it owes the reader is the sentence that came back.
  # Without it a refused write would do nothing visible at all.
  Scenario: A name another label already holds is refused, and the page says why
    Given the reviewer opens the settings page
    When the reviewer opens the "labels" settings section
    And the reviewer creates the label "MIGRATED"
    Then the settings page refuses with "already exists"
    And the labels read:
      | migrated     |
      | needs triage |
      | wontfix      |

  # ── the toggle ────────────────────────────────────────────────────────────

  # When the switch is off, the user can be certain the AI cannot touch the
  # vocabulary. Off is what a store nobody has configured is, and no row says
  # so.
  Scenario: The switch is off until the human turns it on, and says what off means
    Given the reviewer opens the settings page
    # No press: General is the first section this page opens on.
    Then the AI config switch is off
    And the settings page says "The AI cannot change this vocabulary. Its attempts are refused by the store itself, not by this page."
    When the reviewer turns the AI config switch on
    Then the AI config switch is on
    And the settings page says "The AI can change this vocabulary. It still cannot put a label on a record, or set a value — those are yours."
    When the reviewer turns the AI config switch off
    Then the AI config switch is off

  # Both themes, one channel at a time, because a dark override that suppresses
  # one channel leaves the others standing and a joined assertion passes on the
  # strength of whichever survived.
  Scenario Outline: The switch looks different on than off, in either theme
    Given the reviewer opens the settings page
    When the reviewer opens the "appearance" settings section
    And the reviewer sets dark mode to "<theme>"
    And the reviewer opens the "general" settings section
    Then the AI config switch stands out when it is on
    And the browser reported no console errors

    Examples:
      | theme |
      | light |
      | dark  |

  # The quiet line an unconfigured store lands on is the first thing anybody
  # ever sees of this feature. Nothing deletes a definition, so this state
  # cannot be performed — it is arranged.
  Scenario: A store nobody has configured says so, on both vocabularies
    Given nobody has configured a vocabulary
    And the reviewer opens the settings page
    # The count recedes rather than vanishing: "Labels (0)" is a fact about the
    # store, and a section with no number would read as one that cannot count.
    Then the settings sections read:
      | labels     | Labels (0)     |
      | attributes | Attributes (0) |
    And the AI config switch is off
    When the reviewer opens the "labels" settings section
    Then the settings page says there are no labels yet
    When the reviewer opens the "attributes" settings section
    Then the settings page says there are no attributes yet

  # ── labels on a record ────────────────────────────────────────────────────

  Scenario: A record wears its labels, and says which of them are retired
    Given the reviewer opens record 2 directly
    Then the record page wears the labels:
      | wontfix |
    And the label "wontfix" on the record page is marked retired

  Scenario: The human puts a label on a record
    Given the reviewer opens record 3 directly
    Then the record page wears no labels
    When the reviewer gives the record the label "migrated"
    Then the record page wears the labels:
      | migrated |

  Scenario: The human takes a label off a record
    Given the reviewer opens record 1 directly
    Then the record page wears the labels:
      | migrated |
    When the reviewer takes the label "migrated" off the record
    Then the record page wears no labels

  # A retired label cannot be applied and can always be removed. The asymmetry is
  # the point: a record left wearing one with no way to take it off would be a
  # classification nobody can correct.
  Scenario: A retired label the record wears can still be taken off
    Given the reviewer opens record 2 directly
    Then the record page offers the label "wontfix"
    When the reviewer takes the label "wontfix" off the record
    Then the record page wears no labels
    And the record page does not offer the label "wontfix"

  # (retroId, rid) is the identity, and both retro 1 and retro 3 hold a record
  # called r-stale-lock. Record 6 is retro 3's, so a page sending a hardcoded
  # retrospective would write against retro 1's namesake and this page would come
  # back wearing nothing.
  Scenario: A label lands on the record's own retrospective
    Given the reviewer opens record 6 directly
    Then the record page wears no labels
    When the reviewer gives the record the label "needs triage"
    Then the record page wears the labels:
      | needs triage |

  Scenario: A record page on an unconfigured store says where labels are made
    Given nobody has configured a vocabulary
    And the reviewer opens record 1 directly
    Then the record page wears no labels
    And the label menu says there are no labels yet

  # ── attribute values on a record ──────────────────────────────────────────

  Scenario: A record carries its values, with the name and the type of each
    Given the reviewer opens record 1 directly
    Then the record carries the values:
      | external issue id | url    | https://github.com/example-user/retro/issues/91 |
      | story points      | number | 5                                               |
    And the value "external issue id" links to "https://github.com/example-user/retro/issues/91"
    And the value "story points" is not a link
    And the value "story points" is marked retired

  Scenario: The human sets a value
    Given the reviewer opens record 3 directly
    Then the record carries no values
    When the reviewer sets "moved on" to "2026-09-01"
    Then the record carries the values:
      | moved on | date | 2026-09-01 |

  Scenario: The human changes a value through the same control
    Given the reviewer opens record 1 directly
    When the reviewer sets "external issue id" to "https://github.com/example-user/retro/issues/204"
    Then the record carries the values:
      | external issue id | url    | https://github.com/example-user/retro/issues/204 |
      | story points      | number | 5                                                |

  Scenario: The human clears a value
    Given the reviewer opens record 1 directly
    When the reviewer clears the value "story points"
    Then the record carries the values:
      | external issue id | url | https://github.com/example-user/retro/issues/91 |

  # The light validation each type carries is the domain's, and this page does
  # not restate it — so what it owes the reader is the refusal, verbatim.
  Scenario: A value the type refuses is refused, and the page says so
    Given the reviewer opens record 3 directly
    When the reviewer sets "moved on" to "the first of September"
    Then the value panel refuses with "not a valid date"
    And the record carries no values

  # A retired attribute is not offered, and the value already carried keeps its
  # Clear — the same asymmetry the labels have.
  Scenario: A retired attribute is not offered, and what carries it can still clear it
    Given the reviewer opens record 1 directly
    Then the record page does not offer the attribute "story points"
    And the record page offers the attribute "moved on"
    When the reviewer clears the value "story points"
    Then the record carries the values:
      | external issue id | url | https://github.com/example-user/retro/issues/91 |

  # ── the surfaces that only read ───────────────────────────────────────────

  # A review card shows what a record wears and offers no way to change it: a
  # verdict is what that page is for, and labelling is what the record's own page
  # is for.
  Scenario: The review card shows a record's labels and offers no control
    Given the reviewer opens retro 1
    Then record "r-stale-lock" on the review wears the labels:
      | migrated |
    And the review page offers no way to label a record

  Scenario: A records row shows what the record wears
    Given the reviewer opens the records page
    Then record "r-stale-lock" of retro 1 wears the labels:
      | migrated |
    And record "r-silent-tailer" of retro 1 wears no labels

  # ── the label filter ──────────────────────────────────────────────────────

  # Being able to filter on the label is the whole argument for why a label beats
  # a comment carrying the same words. It is behind the filter icon rather than
  # on the bar because the vocabulary is unbounded: a store with fifteen labels
  # would wrap the bar to four lines.
  Scenario: The label filter counts what the page holds, and narrows to it
    Given the reviewer opens the records page
    Then the filters count:
      | filter         | count |
      | label-migrated | 1     |
      | label-wontfix  | 1     |
    When the reviewer filters to the label "migrated"
    Then the records page lists 1 record
    And the records read, in order:
      | retro | rid          |
      | 1     | r-stale-lock |

  # Within a dimension the chips are an OR, like every other dimension here:
  # picking two classifications reads as "show me both kinds".
  Scenario: Two labels are an either-or
    Given the reviewer opens the records page
    When the reviewer filters to the label "migrated"
    And the reviewer filters to the label "wontfix"
    Then the records page lists 2 records
    And the records read, in order:
      | retro | rid                |
      | 1     | r-stale-lock       |
      | 1     | r-bullet-responses |

  Scenario: The label filter composes with the ones beside it
    Given the reviewer opens the records page
    When the reviewer filters to the label "migrated"
    And the reviewer filters to the requester "ai"
    Then the records page lists 0 records
    And the records page says "No records match the selected filters — 7 records are hidden"

  # A label nobody has applied is not a question anyone can ask on this page, so
  # the group is absent rather than empty — the same call the review bar makes
  # about the verdict nobody can give any more.
  Scenario: There is no label filter on a store with nothing labelled
    Given nobody has configured a vocabulary
    And the reviewer opens the records page
    Then the filters do not offer a label group

  # The standing limit, on the two screens this product is read on. The settings
  # page carries the widest thing it has — a full attribute name beside a type
  # and two controls — on the layout's own measure.
  Scenario Outline: The settings page reads cleanly on every screen it is opened on
    Given the reviewer's screen is <width> by <height>
    And the reviewer opens the settings page
    When the reviewer opens the "labels" settings section
    Then the labels read:
      | migrated     |
      | needs triage |
      | wontfix      |
    And the page is <measure> pixels wide
    And the page does not scroll sideways
    And the browser reported no console errors

    Examples:
      | width | height | measure |
      | 1536  | 960    | 1536    |
      | 1440  | 900    | 1024    |
      | 1024  | 1366   | 1024    |
