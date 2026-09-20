import { appendOnlyTriggers, type Migration } from '#infrastructure/sqlite/migration'

/**
 * `revision_n` is nullable: the AI may answer a request before the revision that
 * addresses it exists ("looking at it"), and cites one only when there is one.
 *
 * The responses are append-only, and only the human may close a request.
 * The parent `requests` row deliberately has no such triggers — closing one is a
 * state change the human is entitled to make — so the protection sits exactly
 * where the record of what was said lives.
 */
export const migration: Migration = {
  version: '20260823120900',
  name: 'create_request_responses',

  up(db) {
    db.exec(`
      CREATE TABLE request_responses (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id INTEGER NOT NULL REFERENCES requests (id),
        text       TEXT    NOT NULL,
        revision_n INTEGER,
        at         TEXT    NOT NULL
      );
      CREATE INDEX ix_request_responses_request ON request_responses (request_id, id);

      ${appendOnlyTriggers('request_responses', 'what the AI said about a request stays said')}
    `)
  },

  down(db) {
    db.exec('DROP TABLE request_responses;')
  },
}
