import { type Database, SQLiteError, type Statement } from 'bun:sqlite'

/**
 * **Why this file exists** (#100 `r-db-exec-swallows-errors`).
 *
 * `db.exec` and `db.run` report a *runtime* failure — a trigger's `RAISE(ABORT)`,
 * a constraint, a CHECK — only when the string they are handed holds exactly one
 * statement and nothing after it. Give them anything more and the failure is
 * dropped on the floor: the statement does not happen, the caller is told nothing,
 * and the statements after it run anyway. A trailing newline is enough to cross
 * that line, so every migration in this repository — each one an indented template
 * literal — was on the wrong side of it.
 *
 * The consequence is the one that matters: a migration can half-apply, commit, and
 * be ledgered as applied. It was found the way these things are found, by a worker
 * planting an UPDATE that the append-only triggers had to refuse and watching the
 * whole suite stay green. `checked-exec.test.ts` holds the five cases as evidence.
 *
 * **The fix is to run one statement at a time.** A statement compiled on its own
 * and run on its own throws, always — that half of the driver has never been in
 * doubt, and `create_record_ids` has been relying on it through `prepare` since it
 * shipped.
 *
 * **SQLite does the splitting, not a regular expression.** `prepare()` compiles
 * the first statement of whatever it is given and silently ignores the rest, and
 * `statement.toString()` hands back exactly the source text it consumed — so
 * advancing past it is the engine's own answer to where the statement ended, and
 * cannot disagree with the engine. That matters more here than anywhere: this
 * schema is full of `CREATE TRIGGER … BEGIN … END`, whose bodies are semicolons
 * inside a statement, and a splitter that cut on `;` would hand SQLite half a
 * trigger. String literals holding semicolons and `--`/block comments come free
 * for the same reason.
 */

/**
 * What a migration is allowed to reach — deliberately not `Database`.
 *
 * The record asked for the class to die rather than the instance: *"no future
 * migration can silently half-apply, whatever its author remembers."* Converting
 * the 46 `db.exec` call sites that exist today would fix every one of them and
 * leave the 47th, written next month by someone who never read this file. So the
 * migrator hands migrations this instead, and the only `exec` in scope is already
 * the checked one. Nothing has to be remembered.
 *
 * `query` and `prepare` pass straight through: a prepared statement is one
 * statement by construction and has always thrown on a runtime failure. `run` is
 * here because a single parameterised write is the same thing again, and the
 * migrator's own ledger write uses it.
 */
export type MigrationDb = {
  /** Every statement compiled and run on its own, so every failure throws. */
  exec(sql: string): void
  /**
   * The two reads and the parameterised write, with the driver's own signatures
   * rather than restatements of them: a migration writes `db.query<Row, []>(…)`
   * exactly as it always has, and a bun upgrade that widens a binding type widens
   * this with it instead of silently disagreeing.
   */
  run: Database['run']
  query: Database['query']
  prepare: Database['prepare']
}

/**
 * Runs every statement in `sql`, one compiled statement at a time, and returns
 * how many there were.
 *
 * The count is not decoration: it is the only thing that distinguishes "the batch
 * ran" from "the batch was quietly empty", and `checked-exec.test.ts` asserts it
 * per case — a splitter that lost a statement would otherwise look exactly like a
 * splitter that worked.
 *
 * The loop ends when SQLite says there is nothing left to compile, and it is the
 * engine that says so rather than a check of our own: bun raises a plain `Error`
 * for a remainder that holds no statement (empty, whitespace, comments) and a
 * `SQLiteError` for one it could not compile. Only the second is a failure, and it
 * is rethrown untouched — a migration author reading a syntax error wants
 * SQLite's own words and byte offset, not ours wrapped around them.
 */
export function execChecked(db: Database, sql: string): number {
  let remaining = sql
  let ran = 0

  for (;;) {
    let statement: Statement<unknown, []>
    try {
      statement = db.prepare<unknown, []>(remaining)
    } catch (error) {
      // A real compile failure — the batch stops here, loudly, exactly as it
      // would have if this statement had been the only one in the string.
      if (error instanceof SQLiteError) throw error
      // Nothing left but whitespace and comments. This is also what an
      // unterminated block comment looks like, which is the same nothing:
      // SQLite reads it as running to the end of the input.
      return ran
    }

    const consumed = statement.toString()
    if (consumed.length === 0) {
      statement.finalize()
      return ran
    }

    try {
      // The point of the whole file: on its own, this throws.
      statement.run()
    } finally {
      statement.finalize()
    }
    ran += 1

    const at = remaining.indexOf(consumed)
    if (at === -1) {
      // Unreachable while `toString()` returns the source text it compiled. It is
      // checked rather than assumed because the failure it guards against is a
      // silent one: the loop would re-run the same statement or drop the rest of
      // the batch, and either would look like success.
      throw new Error(
        `checked exec cannot advance: SQLite compiled a statement it did not take from the source (${consumed.slice(0, 60)})`,
      )
    }
    remaining = remaining.slice(at + consumed.length)
  }
}

/**
 * The `MigrationDb` a migration is run against.
 *
 * A plain object rather than a proxy: the three pass-through methods are bound to
 * the real database and the one that matters is replaced outright, so there is no
 * cleverness to reason about and nothing that behaves differently under a native
 * method's `this`.
 */
export function checkedDb(db: Database): MigrationDb {
  return {
    exec(sql) {
      execChecked(db, sql)
    },
    /**
     * A `run` carrying bindings is one statement by construction, so it goes
     * straight to the driver — binding a parameter list is exactly the thing
     * multi-statement text cannot do. A bare `run(sql)` is the same string an
     * `exec` would have taken and is checked like one.
     */
    run: ((sql: string, ...bindings: unknown[]) =>
      bindings.length === 0
        ? execChecked(db, sql)
        : (db.run as (sql: string, ...rest: unknown[]) => unknown)(
            sql,
            ...bindings,
          )) as Database['run'],
    query: db.query.bind(db),
    prepare: db.prepare.bind(db),
  }
}
