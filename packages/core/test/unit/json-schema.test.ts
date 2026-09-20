import { describe, expect, test } from 'bun:test'
import {
  ASSERTED_KEYWORDS,
  type JsonSchema,
  keywordsUsed,
  loadExportSchema,
  unhandledKeywords,
  validate,
} from '../support/json-schema'

/**
 * The validator that proves the export conforms is itself only worth something if
 * it can fail. These are the documents it must reject — a validator that accepts
 * everything would make the export test a green light for nothing.
 */
const schema: JsonSchema = {
  type: 'object',
  required: ['format', 'count', 'items'],
  additionalProperties: false,
  properties: {
    format: { const: 'test.v1' },
    count: { type: 'integer', minimum: 1, maximum: 5 },
    note: { type: ['string', 'null'] },
    kind: { enum: ['a', 'b'] },
    slug: { type: 'string', pattern: '^r-[a-z]+$', minLength: 3, maxLength: 6 },
    items: { type: 'array', minItems: 1, maxItems: 2, items: { $ref: '#/$defs/item' } },
  },
  $defs: {
    item: {
      type: 'object',
      required: ['id'],
      additionalProperties: false,
      properties: { id: { type: 'integer' } },
    },
  },
}

const valid = { format: 'test.v1', count: 2, items: [{ id: 1 }] }

describe('the schema validator', () => {
  test('accepts a conforming document', () => {
    expect(validate(valid, schema)).toEqual([])
  })

  test('rejects a missing required property', () => {
    expect(validate({ format: 'test.v1', items: [{ id: 1 }] }, schema)).toEqual([
      '$: missing required property count',
    ])
  })

  test('treats an explicitly undefined property as absent, the way JSON does', () => {
    // `JSON.stringify` drops it, so a document carrying `reviewerNote: undefined`
    // would ship without the key — the validator must see what the file will.
    expect(validate({ ...valid, count: undefined }, schema)).toEqual([
      '$: missing required property count',
    ])
  })

  test('rejects an unexpected property', () => {
    expect(validate({ ...valid, extra: true }, schema)).toEqual(['$: unexpected property extra'])
  })

  test('rejects a wrong const, enum or type', () => {
    expect(validate({ ...valid, format: 'test.v2' }, schema)).toHaveLength(1)
    expect(validate({ ...valid, kind: 'c' }, schema)).toHaveLength(1)
    // One problem, not a cascade: a value of the wrong type is not also range-checked.
    expect(validate({ ...valid, count: 'two' }, schema)).toEqual([
      '$.count: expected integer, got string',
    ])
  })

  test('accepts either branch of a nullable type and rejects the rest', () => {
    expect(validate({ ...valid, note: null }, schema)).toEqual([])
    expect(validate({ ...valid, note: 'a note' }, schema)).toEqual([])
    expect(validate({ ...valid, note: 7 }, schema)).toHaveLength(1)
  })

  test('enforces ranges, lengths and patterns', () => {
    expect(validate({ ...valid, count: 9 }, schema)).toHaveLength(1)
    expect(validate({ ...valid, items: [] }, schema)).toHaveLength(1)
    expect(validate({ ...valid, items: [{ id: 1 }, { id: 2 }, { id: 3 }] }, schema)).toHaveLength(1)
    expect(validate({ ...valid, slug: 'nope' }, schema)).toHaveLength(1)
    expect(validate({ ...valid, slug: 'r-ok' }, schema)).toEqual([])
    expect(validate({ ...valid, slug: 'r-toolong' }, schema)).toEqual([
      '$.slug: longer than maxLength 6',
    ])
  })

  test('follows $ref into $defs and reports the path that failed', () => {
    const problems = validate({ ...valid, items: [{ id: 'one', extra: 1 }] }, schema)

    expect(problems).toContain('$.items[0].id: expected integer, got string')
    expect(problems).toContain('$.items[0]: unexpected property extra')
  })
})

/**
 * Retro 3 `r-validator-silent-keywords`.
 *
 * Every test above proves the validator enforces a rule it knows. None of them
 * could see the other failure mode: a keyword it has *never heard of* is skipped
 * in silence, so a `multipleOf` or a `oneOf` added to the shipped contract would
 * be a rule nobody enforces while "the export conforms" stayed green — the same
 * false green the whole file exists to rule out.
 *
 * So the coverage is checked against the shipped file rather than assumed.
 */
describe('the validator’s keyword coverage', () => {
  /**
   * The walker at depth, and the fixture above as its own audit.
   *
   * Asserting the fixture's keywords *are* `ASSERTED_KEYWORDS` says two things
   * at once: the walk reaches every schema position (the `$ref` inside
   * `items` is four levels down), and every keyword this file claims to
   * implement has a test above exercising it.
   *
   * `format` is the case that proves the walk reads schema positions rather
   * than object keys: the fixture has a *property* called `format`, and it is
   * deliberately not in this list.
   */
  test('finds every keyword of a nested schema, and never a property name', () => {
    expect(keywordsUsed(schema)).toEqual(ASSERTED_KEYWORDS)
  })

  test('names a keyword the validator would silently ignore', () => {
    const grown: JsonSchema = {
      ...schema,
      properties: {
        ...(schema.properties as Record<string, JsonSchema>),
        count: { type: 'integer', multipleOf: 2 },
      },
    }

    // Silently, today: the document below breaks the new rule and passes.
    expect(validate({ ...valid, count: 3 }, grown)).toEqual([])
    expect(unhandledKeywords(grown)).toEqual(['multipleOf'])
  })

  /**
   * The shipped contract, walked. When a keyword is added to
   * `export.v1.schema.json`, this fails naming it — and the answer is either to
   * implement it in `validate` or to record it in `IGNORED_KEYWORDS` with the
   * reason it is annotation-only. What it may not be is nothing.
   */
  test('handles every keyword export.v1.schema.json actually uses', () => {
    const unhandled = unhandledKeywords(loadExportSchema())

    expect(
      unhandled,
      'export.v1.schema.json uses keywords this validator neither asserts nor documents as ignored',
    ).toEqual([])
  })
})
