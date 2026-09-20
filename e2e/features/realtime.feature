Feature: Real time, across two browsers and a CLI

  One SSE stream per page, fed by the tailer from the database. Nobody notifies
  anybody directly: the CLI writes and leaves, and both pages find out.

  Scenario: a new revision is announced to every open page, and a decision propagates
    Given a stage with the server running
    And the AI has filed a revision with 2 records
    # The loop's rhythm, and the only way a second revision lands: the human
    # marks what is to be rewritten and finishes the round, and the AI's next
    # draft answers it. It happens before the pages open so that this scenario
    # stays about the stream.
    And the human has asked for a rewrite and finished the round
    And two reviewers have the review open
    When the AI files a second revision
    Then both pages announce revision 2
    And neither page has swapped in the new content
    When the first reviewer approves record "r-record-1"
    Then the second reviewer sees "r-record-1" approved
