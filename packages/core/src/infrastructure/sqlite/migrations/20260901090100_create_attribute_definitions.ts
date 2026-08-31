import type { Migration } from '#infrastructure/sqlite/migration'

/**
 * The attribute vocabulary — the second primitive, and the queryable one.
 *
 * The owner: *"the user can create attributes and then assign values to those
 * attributes … they could create an attribute that says 'Jira ticket', or maybe
 * just 'external ticket ID' or whatever, and then they can say it's always going
 * to be a number. Then it will be easier for them to query."*
 *
 * It is `label_definitions` plus one column, and the extra column is the reason
 * the primitive exists: a type is what turns a per-record value from prose into
 * something a reader can rely on. Everything else is the same — global, mutable
 * configuration, never append-only, retired rather than deleted, and **empty on
 * day one**.
 *
 * The CHECK is the same shape every enum in this schema has: **widened, never
 * narrowed**. Four types is the owner's *"very fixed types"* and the set is
 * closed by his ruling rather than by this constraint; a fifth would be a
 * rebuild, exactly as widening `record_lifecycle.status` was
 * (`20260831090000_record_lifecycle_allow_archive.ts`).
 *
 * `type` has no `ALTER`-time story on purpose: nothing in the product changes an
 * attribute's type after values exist under it, because every stored value was
 * accepted under the old one and this store never rewrites what somebody wrote
 * (`attribute.model.ts`).
 */
export const migration: Migration = {
  version: '20260901090100',
  name: 'create_attribute_definitions',

  up(db) {
    db.exec(`
      CREATE TABLE attribute_definitions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL UNIQUE,
        type       TEXT    NOT NULL CHECK (type IN ('number', 'text', 'url', 'date')),
        retired_at TEXT,
        created_at TEXT    NOT NULL
      );
    `)
  },

  down(db) {
    db.exec('DROP TABLE attribute_definitions;')
  },
}
