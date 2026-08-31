Feature: Upgrading a stage an older binary wrote

  Migrations are invisible: whichever process opens the stage first applies what
  is pending, under the write lock, having taken a backup. Nobody runs a migrate
  command, because there is not one.

  Scenario: the server migrates the stage on start and the loop still works
    Given a stage written by an older schema, holding a session and a revision
    When the server starts
    Then every migration has been applied
    And a pre-migration backup was taken
    When the reviewer opens the review
    And the reviewer approves every record
    And the reviewer finishes the review
    And the AI closes the review
    Then the review is finished
