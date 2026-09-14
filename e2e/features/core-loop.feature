Feature: The core loop, end to end

  Everything real: a spawned CLI writing as the AI, the server it never talks to,
  a browser where the human decides, and the export file that leaves the product.
  The layers below prove the behaviour; this proves they are wired to each other.

  # The parking step in the middle of this loop went with retro 4
  # `r-remove-hold`, and so did the `held`/`holdNote` fields it put into the
  # export. The file that leaves the product is asserted to carry neither — at
  # the one layer where the real builder writes the real file, which is where a
  # field nobody removed would still show up.
  Scenario: the AI files a revision, the human reviews it, and the export is valid
    Given a stage with the server running
    When the AI registers a session and files a revision with 2 records
    And the AI waits for the review to end
    And the reviewer opens the review
    # The owner's multi-solution shape, proved through the real stack: the CLI
    # wrote it, the server read it out of the blob, and this is the browser
    # rendering it. The layers below each prove their own half; this is the one
    # place all of them are the real thing at once.
    Then the review page shows both solutions of every record
    # RL-52, through the same real stack: a spawned CLI wrote the evidence into
    # the revision blob, the server read it back out, and this is the browser
    # keeping it folded away until the reviewer asks for it — the one thing on a
    # card that starts shut.
    And the diagnostic data of every record is folded away until the reviewer opens it
    When the reviewer approves every record
    And the reviewer finishes the review
    Then the AI's wait returns "ReviewFinished" for revision 1
    # r-finish-button-reenables (retro 10, his report): "I pressed finish review
    # and it said sent. but when I refreshed the page, the finihs review button
    # is enabled again."
    #
    # This is the half no mocked scenario can reach. Suite 4's mock world lives
    # as long as the module, so a real reload there starts a second, empty world
    # and unmakes the finish being asked about — it round-trips through the
    # router instead, which destroys the component and its in-memory state but
    # keeps the world. What it cannot do is prove the fact survives a cold load
    # against a store that already holds it, and that is exactly what the owner
    # did with F5.
    #
    # Here everything is real, and the line above has just proved the store holds
    # the finish: the AI's wait returned ReviewFinished for revision 1 from the
    # database. So this reload is the owner's own gesture, and the page has
    # nothing but the server to answer from.
    When the reviewer reloads the review page
    Then the round is still with the AI, and finishing is not offered again
    # One button, and then the AI's own act: it reads the round, finds nothing
    # left to address, and closes the review to export (retro 4
    # `r-one-finish-button`). Only that makes the retrospective exportable.
    When the AI closes the review
    Then the export validates against export.v1.schema.json
    And the export carries 2 approved records
    And the export says nothing about holds
    # The reviewer never moved the tick off the AI's recommendation, so that is
    # what the verdict carried — and the level it carries is that solution's.
    And the export carries the solutions, and the recommended one as selected
    # And the evidence leaves the product with the outcome, character for
    # character as the AI filed it — the other end of the same field, in the file
    # rather than on the page.
    And the export carries the diagnostic data the AI filed
    # The channel the owner asked for, end to end: typed in the browser, written
    # beside the finish, and read out of the database by the CLI that wrote this
    # file — never as a comment (r-finish-confirm-message).
    And the export carries the final message the reviewer left on the round

