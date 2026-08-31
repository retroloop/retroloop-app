import type { SolutionLevel } from '#domain/models/record.model'

/**
 * Row mapping, in one place.
 *
 * SQLite hands back `null` for an absent value and the domain speaks `undefined`;
 * booleans arrive as 0/1; and a column's declared type quietly rewrites what you
 * put in it. Each helper below names one of those conversions instead of letting
 * it happen by accident in nine adapters.
 */
export function optionalText(value: string | null): string | undefined {
  return value ?? undefined
}

export function optionalNumber(value: number | null): number | undefined {
  return value ?? undefined
}

export function fromBit(value: number): boolean {
  return value === 1
}

export function toBit(value: boolean): number {
  return value ? 1 : 0
}

/**
 * The value came out of a column whose CHECK constraint restricts it to exactly
 * this union (see the table's migration), so the narrowing is backed by the
 * database rather than by hope.
 */
export function checked<T extends string>(value: string): T {
  return value as T
}

/**
 * A solution level is `1`–`5` or a named ceiling, in one TEXT column: a TEXT
 * column turns the number 2 into `'2'` on the way in, so it has to turn back on
 * the way out. Written as a total switch rather than a cast, because this is the
 * one place where "the database says TEXT" and "the domain says number" disagree.
 */
export function toSolutionLevel(value: string): SolutionLevel {
  switch (value) {
    case '1':
      return 1
    case '2':
      return 2
    case '3':
      return 3
    case '4':
      return 4
    case '5':
      return 5
    case 'none':
      return 'none'
    case 'upstream':
      return 'upstream'
    case 'undecided':
      return 'undecided'
    default:
      throw new Error(`unknown solution level stored in the database: ${value}`)
  }
}

export function fromSolutionLevel(level: SolutionLevel): string {
  return String(level)
}

export function parseJson<T>(text: string): T {
  return JSON.parse(text) as T
}
