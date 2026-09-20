Feature: Page chrome

  Every page carries the same brand, the same navigation menu and — wherever
  there is somewhere above it to go — the same trail, and the routes nothing has
  been built on yet are placeholders rather than inventions
  (route contract: docs/design/ui.md).

  The chrome holds exactly two things: what this product is, and where else
  you can go. The theme control that used to sit on the right is not a third
  — it went under Settings › Appearance, and the last scenario here is what
  says the choice made there is the whole app's rather than that page's.

  # The breadcrumbs move out of the top menu to somewhere below it, while the
  # name stays in the menu. These two scenarios are what "below it" means in
  # pixels rather than in prose — the first that the menu still says what the
  # product is, the second that the trail is genuinely under the menu and not in
  # it.
  Scenario: The dashboard states the app name in the top menu and carries no trail
    Given the reviewer opens "/"
    Then the top menu names the app "Retroloop"
    And the page carries no trail

  # A one-crumb trail under a header already saying "Retroloop" would repeat the
  # brand and point nowhere, so the dashboard has none at all. Every page with a
  # parent has one, and it sits below the menu — including the routes nothing has
  # been built on yet.
  Scenario: A placeholder route still carries a real breadcrumb, below the top menu
    Given the reviewer opens "/sessions/7"
    Then the page title is "Session 7"
    And the breadcrumb reads "Retroloop › Session 7"
    And the trail sits below the top menu

  Scenario: A project id that is not an integer is not found
    Given the reviewer opens "/projects/nope"
    Then the page says it cannot find that

  Scenario: A retrospective nothing answers to is not found
    Given the reviewer opens "/retros/404"
    Then the page says it cannot find that

  Scenario: Record history is a stub on the review page's own route
    Given the reviewer opens "/retros/1?record=r-stale-lock&view=history"
    Then the page title is "r-stale-lock"

  Scenario: The review page loads clean in a real browser
    Given the reviewer opens retro 1
    Then the page body is not empty
    And the browser reported no console errors

  # The theme is chrome even though its control is not: it is one choice, made in
  # one place, and every page in the product is painted by it. So the walk is the
  # scenario — the choice is made on the settings page, read on the page it was
  # made from, read again on a third page it never visited, and survives a reload
  # — and it is taken through the app's own controls end to end, because a theme
  # arranged by writing to storage would prove that storage works.
  #
  # It replaces the header toggle's own scenario, which pressed a control that no
  # longer exists. What it keeps from it is both halves of the sentence: an
  # override outlives a reload, and going back to System hands the page to the
  # device again.
  Scenario: The theme is chosen once in Settings and is the whole app's, across pages and reloads
    Given the reviewer opens retro 1
    Then the page is in the "light" theme
    When the reviewer opens the app menu
    And the reviewer follows "Settings" in the app menu
    And the reviewer opens the "appearance" settings section
    And the reviewer sets dark mode to "Dark"
    Then the page is in the "dark" theme
    When the reviewer opens the app menu
    And the reviewer follows "Records" in the app menu
    Then the page is in the "dark" theme
    When the page is reloaded
    Then the page is in the "dark" theme
    When the reviewer opens the app menu
    And the reviewer follows "Settings" in the app menu
    And the reviewer opens the "appearance" settings section
    And the reviewer sets dark mode to "System"
    Then the page is in the "light" theme
    And the browser reported no console errors

  # The menu items move under a single dropdown in the top right, built with the
  # shadcn dropdown-menu component.
  #
  # Three claims, and all three are asserted: the menu is in the top right, it
  # holds these two items in this order, and each item is a real link — which is
  # why open-in-new-tab works and why the table reads hrefs. The absence beside
  # it is counted rather than named: the claim is that nothing is left loose up
  # there, not that two particular testids went away.
  Scenario: Global navigation is one dropdown in the top right, with nothing loose beside it
    Given the reviewer opens "/"
    Then the top menu carries no loose navigation links
    And the top menu carries no theme control
    And the app menu sits at the right end of the top menu
    When the reviewer opens the app menu
    Then the app menu points at:
      | Records  | /records  |
      | Settings | /settings |
    And the browser reported no console errors

  # The menu is the shell's and not the dashboard's, which is the half of the
  # record every other page is paid by: the review page had no way to anywhere at
  # all, and now carries the same menu in the same place as the page the links
  # used to live on.
  Scenario: The review page carries the same menu, in the same place
    Given the reviewer opens retro 1
    Then the top menu carries no loose navigation links
    And the top menu carries no theme control
    And the app menu sits at the right end of the top menu
    When the reviewer opens the app menu
    Then the app menu points at:
      | Records  | /records  |
      | Settings | /settings |

  # The starved-menu certification drives a deterministically starved menu close
  # so the waits around it are proven rather than described — without it, a
  # budget move would be an edit nothing could certify. This scenario itself
  # does not move a budget: it is what says the ones already there are sized for
  # the mechanism rather than for a healthy laptop, and it is red when they are
  # not. It was re-aimed at this menu after the header's theme toggle was
  # retired.
  #
  # The renderer is starved by Chromium's own CPU throttle rather than by the
  # main-thread hold review.feature's landing scenario uses, and the choice was
  # measured. The hold loop quantises the page into whole periods and lets the
  # menu close commit inside one, between two of the harness's acts; the throttle
  # slows the close by a factor instead, so the waits actually spend budget and a
  # budget that is too small is red rather than lucky. Both engines' numbers are
  # in the step docstrings.
  #
  # The throttle is applied FIRST, before the menu is opened: the open, the close
  # and the navigation after it are all starved, so all three of this scenario's
  # waits are the ones under test rather than only the middle one.
  #
  # @starved: it starves its own renderer on purpose, which is the whole of the
  # membership rule (docs/design/testing.md §The stall edge).
  @starved
  Scenario: The app menu opens, closes and arrives on a renderer running fifty times slower
    Given the reviewer opens "/"
    When the renderer runs 50 times slower
    And the reviewer opens the app menu
    And the reviewer follows "Records" in the app menu
    Then the reviewer has arrived at the records page
