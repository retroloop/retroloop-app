import { Database } from 'bun:sqlite'
import { afterAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { checkedDb, execChecked } from '#infrastructure/sqlite/checked-exec'
import { appendOnlyTriggers } from '#infrastructure/sqlite/migration'
import { createTempStage, removeTempStages } from '../support/temp-stage'

afterAll(removeTempStages)

/**
 * A throwaway database on disk rather than `:memory:` — the same stage layout the
 * product uses, so nothing here is true only of an in-memory special case.
 */
function throwawayDb(): Database {
  const db = new Database(join(createTempStage(), 'retro.db'), { create: true })
  db.run('PRAGMA foreign_keys = ON')
  return db
}

/**
 * The fixture the five-case characterization runs against: one ordinary table to
 * count landed writes in, and one guarded table whose append-only triggers refuse
 * an UPDATE at **runtime** — which is the whole point. A trigger's `RAISE(ABORT)`
 * compiles fine and fails only when the statement runs, and that is the class of
 * failure this file is about.
 */
function seed(db: Database): void {
  db.exec(`CREATE TABLE landed (id INTEGER PRIMARY KEY, v TEXT NOT NULL)`)
  db.exec(`CREATE TABLE guarded (id INTEGER PRIMARY KEY, v TEXT NOT NULL)`)
  db.exec(appendOnlyTriggers('guarded', 'the characterization needs a runtime refusal'))
  db.exec(`INSERT INTO guarded (id, v) VALUES (1, 'original')`)
}

/** Which ids landed in `landed`, in order — "did the later statements still run?" */
function landedIds(db: Database): number[] {
  return db
    .query<{ id: number }, []>('SELECT id FROM landed ORDER BY id')
    .all()
    .map((row) => row.id)
}

function threwFrom(act: () => void): string | undefined {
  try {
    act()
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/**
 * **The characterization (`r-db-exec-swallows-errors`), re-derived.**
 *
 * The original five-case table was written up elsewhere and did not survive,
 * so this is the evidence itself rather than a copy of it: every case below
 * was run against bun 1.4.0 on a throwaway database and asserts what the
 * driver actually did.
 *
 * **It corrects the record's prose in one place, and the correction makes the bug
 * worse rather than smaller.** `r-db-exec-swallows-errors` says a runtime failure
 * propagates "only from the first statement" — that is not the boundary. The
 * boundary is whether the string bun is handed contains **exactly one statement
 * and nothing after it**: a runtime failure in the first of two statements is
 * swallowed just as thoroughly as one in the second, and a single statement
 * followed by nothing but a newline is swallowed too. Since every migration in
 * this repository is written as an indented template literal, every one of them
 * was on the swallowing side of that line — including the ones with a single
 * statement in them.
 *
 * `run` and `exec` are the same function here for every case; the record says so
 * and this holds it to it, because a fix that checked only one of them would look
 * right and cover half the call sites.
 */
describe('bun:sqlite swallows runtime errors in a multi-statement string', () => {
  describe.each([
    ['exec', (db: Database, sql: string) => db.exec(sql)],
    ['run', (db: Database, sql: string) => db.run(sql)],
  ] as const)('db.%s', (_name, call) => {
    test('case 1 — a prepare-time error in the first statement throws', () => {
      const db = throwawayDb()
      seed(db)

      const message = threwFrom(() =>
        call(db, `THIS IS NOT SQL; INSERT INTO landed VALUES (1, 'a');`),
      )

      expect(message).toContain('syntax error')
      expect(landedIds(db)).toEqual([])
      db.close()
    })

    test('case 2 — a prepare-time error in a later statement throws, and earlier writes stay', () => {
      const db = throwawayDb()
      seed(db)

      const message = threwFrom(() =>
        call(db, `INSERT INTO landed VALUES (1, 'a'); THIS IS NOT SQL;`),
      )

      // The whole batch is compiled before any of it runs only in the sense that
      // bun compiles statement by statement: the INSERT already ran.
      expect(message).toContain('syntax error')
      expect(landedIds(db)).toEqual([1])
      db.close()
    })

    /**
     * The one shape that behaves: exactly one statement, no trailing text at all.
     * It is the reason the bug hid for so long — every hand-run reproduction in a
     * REPL is written this way and throws exactly as expected.
     */
    test('case 3 — a runtime error DOES throw when the string is one bare statement', () => {
      const db = throwawayDb()
      seed(db)

      const message = threwFrom(() => call(db, `UPDATE guarded SET v = 'rewritten'`))

      expect(message).toContain('guarded are append-only')
      db.close()
    })

    /**
     * Same statement, same trigger, one trailing newline — and the refusal is
     * gone. This is the case the record's "only the first statement" wording
     * misses, and it is why the fix cannot be "put the risky statement first".
     */
    test('case 4 — the SAME runtime error is swallowed once anything trails it', () => {
      const db = throwawayDb()
      seed(db)

      const message = threwFrom(() => call(db, `UPDATE guarded SET v = 'rewritten';\n`))

      expect(message).toBeUndefined()
      // Nothing was written either: the statement was refused, silently.
      expect(db.query<{ v: string }, []>('SELECT v FROM guarded').get()?.v).toBe('original')
      db.close()
    })

    /**
     * **The plant that should have aborted a migration and passed every test.**
     *
     * An UPDATE the append-only triggers refuse, placed after a benign INSERT:
     * the INSERT lands, the UPDATE silently does not, the statement after it runs
     * anyway, and the caller is told nothing. A migration shaped like this
     * half-applies, commits, and is ledgered as applied.
     */
    test('case 5 — a runtime error in a later statement is swallowed and the rest still runs', () => {
      const db = throwawayDb()
      seed(db)

      const message = threwFrom(() =>
        call(
          db,
          `INSERT INTO landed VALUES (1, 'before');
           UPDATE guarded SET v = 'rewritten';
           INSERT INTO landed VALUES (2, 'after');`,
        ),
      )

      expect(message).toBeUndefined()
      expect(landedIds(db)).toEqual([1, 2])
      expect(db.query<{ v: string }, []>('SELECT v FROM guarded').get()?.v).toBe('original')
      db.close()
    })
  })
})

/**
 * The helper the migrator runs every migration through. The cases above are its
 * fixture: what the driver swallows, this must throw.
 */
describe('execChecked', () => {
  test('the swallowed UPDATE-after-INSERT throws — the case that started this', () => {
    const db = throwawayDb()
    seed(db)

    expect(() =>
      execChecked(
        db,
        `INSERT INTO landed VALUES (1, 'before');
         UPDATE guarded SET v = 'rewritten';
         INSERT INTO landed VALUES (2, 'after');`,
      ),
    ).toThrow(/guarded are append-only/)

    // It threw where the failure was, so the statement after it never ran. That
    // is what lets the migrator's transaction roll back a whole migration.
    expect(landedIds(db)).toEqual([1])
    db.close()
  })

  test('a runtime error in the FIRST of several statements throws too', () => {
    const db = throwawayDb()
    seed(db)

    expect(() =>
      execChecked(
        db,
        `UPDATE guarded SET v = 'rewritten';
         INSERT INTO landed VALUES (1, 'after');`,
      ),
    ).toThrow(/guarded are append-only/)

    expect(landedIds(db)).toEqual([])
    db.close()
  })

  test('a single statement with trailing whitespace throws — case 4, checked', () => {
    const db = throwawayDb()
    seed(db)

    expect(() => execChecked(db, `UPDATE guarded SET v = 'rewritten';\n   `)).toThrow(
      /guarded are append-only/,
    )
    db.close()
  })

  test('a prepare-time error still throws, and stops the batch where it is', () => {
    const db = throwawayDb()
    seed(db)

    expect(() => execChecked(db, `INSERT INTO landed VALUES (1, 'a'); THIS IS NOT SQL;`)).toThrow(
      /syntax error/,
    )

    expect(landedIds(db)).toEqual([1])
    db.close()
  })

  test('runs every statement of a batch that is fine, and says how many', () => {
    const db = throwawayDb()
    seed(db)

    const count = execChecked(
      db,
      `INSERT INTO landed VALUES (1, 'a');
       INSERT INTO landed VALUES (2, 'b');
       INSERT INTO landed VALUES (3, 'c');`,
    )

    expect(count).toBe(3)
    expect(landedIds(db)).toEqual([1, 2, 3])
    db.close()
  })

  /**
   * **The reason the splitting is SQLite's and not a regular expression.**
   *
   * A trigger body is `BEGIN … END` with semicolons inside it, and this schema is
   * full of them — every human-authored table ships an append-only pair
   * (`migration.ts`). A splitter that cut on `;` would hand SQLite half a trigger.
   */
  test('a trigger body’s inner semicolons do not split it', () => {
    const db = throwawayDb()
    seed(db)

    const count = execChecked(
      db,
      `CREATE TABLE journal (id INTEGER PRIMARY KEY, v TEXT NOT NULL);
       ${appendOnlyTriggers('journal', 'entries are never rewritten')}`,
    )

    expect(count).toBe(3)
    expect(() => db.run(`INSERT INTO journal VALUES (1, 'a')`)).not.toThrow()
    expect(() => db.run(`UPDATE journal SET v = 'b' WHERE id = 1`)).toThrow(
      /journal are append-only/,
    )
    expect(() => db.run(`DELETE FROM journal WHERE id = 1`)).toThrow(/journal are never deleted/)
    db.close()
  })

  test('a semicolon inside a string literal does not split it', () => {
    const db = throwawayDb()
    seed(db)

    const count = execChecked(db, `INSERT INTO landed VALUES (1, 'a;b;c');`)

    expect(count).toBe(1)
    expect(db.query<{ v: string }, []>('SELECT v FROM landed').get()?.v).toBe('a;b;c')
    db.close()
  })

  test('comments and blank space between statements are not statements', () => {
    const db = throwawayDb()
    seed(db)

    const count = execChecked(
      db,
      `-- a leading line comment
       INSERT INTO landed VALUES (1, 'a');

       /* a block ; comment */
       INSERT INTO landed VALUES (2, 'b');
       -- a trailing comment, and nothing after it
      `,
    )

    expect(count).toBe(2)
    expect(landedIds(db)).toEqual([1, 2])
    db.close()
  })

  test('a batch of nothing but comments and whitespace runs nothing and does not throw', () => {
    const db = throwawayDb()
    seed(db)

    expect(execChecked(db, `\n  -- nothing to do here\n  /* really */\n `)).toBe(0)
    expect(execChecked(db, '')).toBe(0)
    db.close()
  })
})

/**
 * The facade the migrator hands every migration. It exists so that the class dies
 * rather than the instance: a migration cannot reach the unchecked `exec` because
 * the only `exec` in scope is this one, whatever its author remembers.
 */
describe('checkedDb', () => {
  test('its exec is the checked one', () => {
    const db = throwawayDb()
    seed(db)

    expect(() =>
      checkedDb(db).exec(
        `INSERT INTO landed VALUES (1, 'before');
         UPDATE guarded SET v = 'rewritten';`,
      ),
    ).toThrow(/guarded are append-only/)
    db.close()
  })

  /**
   * `query` and `prepare` pass straight through: they were never the problem —
   * a prepared statement is one statement by construction, and `.run()` on one
   * has always thrown. `create_record_ids` mints through `prepare`, so this is
   * the surface a real migration already depends on.
   */
  test('query and prepare reach the real database', () => {
    const db = throwawayDb()
    seed(db)
    const checked = checkedDb(db)

    checked.prepare<unknown, [number, string]>('INSERT INTO landed VALUES (?, ?)').run(7, 'seven')

    expect(checked.query<{ id: number; v: string }, []>('SELECT id, v FROM landed').all()).toEqual([
      { id: 7, v: 'seven' },
    ])
    expect(() => checked.prepare<unknown, []>(`UPDATE guarded SET v = 'rewritten'`).run()).toThrow(
      /guarded are append-only/,
    )
    db.close()
  })
})
