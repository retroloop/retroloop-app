import type { Migration } from '#infrastructure/sqlite/migration'

/**
 * The outbox.
 *
 * Two deliberate absences. The scope columns carry no foreign keys: an event is an
 * audit trail of something that already happened, and it must stay appendable and
 * readable on its own terms rather than through a join. And `name` carries no
 * CHECK constraint: the event vocabulary grows with the product, and additive-first
 * (migrations.md) means a new event name must not need a schema migration before
 * the code that emits it can ship.
 */
export const migration: Migration = {
  version: '20260823121000',
  name: 'create_events',

  up(db) {
    db.exec(`
      CREATE TABLE events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL,
        at         TEXT    NOT NULL,
        session_id INTEGER,
        retro_id   INTEGER,
        revision_n INTEGER,
        rid        TEXT,
        data       TEXT    NOT NULL CHECK (json_valid(data))
      );
      CREATE INDEX ix_events_retro   ON events (retro_id, id);
      CREATE INDEX ix_events_session ON events (session_id, id);
      CREATE INDEX ix_events_name    ON events (name, id);
    `)
  },

  down(db) {
    db.exec('DROP TABLE events;')
  },
}
