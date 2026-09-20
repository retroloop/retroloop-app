import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * A validator for the subset of JSON Schema `export.v1.schema.json` actually
 * uses — `$ref`/`$defs`, `type`, `required`, `additionalProperties`, `enum`,
 * `const`, `items`, and the length/range keywords.
 *
 * Why not a real validator: ajv would be a runtime dependency for a test, and
 * the alternative — hand-listing the fields the export ought to have — is a
 * copy of the schema that silently stops matching it. This reads **the shipped
 * file**, so when the contract changes the test changes with it.
 *
 * It is deliberately small enough to audit, and `json-schema.test.ts` holds it to
 * that: the validator is itself tested against documents known to be invalid, so
 * "the export conforms" cannot be a green light from a validator that accepts
 * anything.
 *
 * `format` (date-time, uuid) is annotation-only in JSON Schema unless a validator
 * opts into assertion, and this one does not — matching the default behaviour of
 * the validators an import script would use.
 */
export type JsonSchema = Record<string, unknown>

/**
 * The keywords `validate` below actually asserts.
 *
 * `$defs` is on the list because `$ref` resolution walks into it; the rest each
 * have a branch of their own. Keeping the list beside the code that implements
 * it is the point: it is this file's declaration of what it can enforce, and
 * `json-schema.test.ts` holds the shipped schema to it.
 */
export const ASSERTED_KEYWORDS: readonly string[] = [
  '$defs',
  '$ref',
  'additionalProperties',
  'const',
  'enum',
  'items',
  'maxItems',
  'maxLength',
  'maximum',
  'minItems',
  'minLength',
  'minimum',
  'pattern',
  'properties',
  'required',
  'type',
]

/**
 * The keywords this validator reads past **on purpose**, each for a stated
 * reason — identity and annotation, plus `format`, which is annotation-only in
 * JSON Schema unless a validator opts into assertion and this one does not (see
 * the header above).
 *
 * The distinction from "not implemented" is the whole of `r-validator-silent-keywords`:
 * a keyword nobody decided about is a rule silently unenforced, and the
 * conformance test would still be green.
 */
export const IGNORED_KEYWORDS: readonly string[] = ['$comment', '$id', '$schema', 'format', 'title']

/** Keywords whose value is a map of *names* to subschemas, not a subschema. */
const SCHEMA_MAPS = ['properties', '$defs']

/** Keywords whose value is one subschema. */
const SUBSCHEMAS = ['items']

/**
 * Every keyword the given schema uses, at any depth, sorted.
 *
 * It descends only through the schema-bearing positions above, so a property
 * *named* `format` or `items` is never mistaken for the keyword of that name,
 * and the values of `enum`/`const` are data rather than schema and are not
 * walked. A container keyword nobody taught it about is collected as an unknown
 * keyword and not descended into — which is the right way round: the caller
 * fails on the newcomer rather than guessing at its shape.
 */
export function keywordsUsed(schema: JsonSchema): readonly string[] {
  const found = new Set<string>()

  const walk = (node: JsonSchema): void => {
    for (const [keyword, value] of Object.entries(node)) {
      found.add(keyword)
      if (typeof value !== 'object' || value === null) continue
      if (SCHEMA_MAPS.includes(keyword)) {
        for (const child of Object.values(value as Record<string, JsonSchema>)) walk(child)
      } else if (SUBSCHEMAS.includes(keyword)) {
        walk(value as JsonSchema)
      }
    }
  }

  walk(schema)
  return [...found].sort()
}

/** The keywords a schema uses that this validator neither asserts nor ignores. */
export function unhandledKeywords(schema: JsonSchema): readonly string[] {
  const known = new Set([...ASSERTED_KEYWORDS, ...IGNORED_KEYWORDS])
  return keywordsUsed(schema).filter((keyword) => !known.has(keyword))
}

export function loadExportSchema(): JsonSchema {
  // `import.meta.dir` is Bun's; this file is also imported by the e2e suite,
  // which Playwright runs under Node. The URL form works in both.
  const here = dirname(fileURLToPath(import.meta.url))
  // packages/core/test/support → repo root
  const path = join(here, '../../../../docs/export/export.v1.schema.json')
  return JSON.parse(readFileSync(path, 'utf8')) as JsonSchema
}

function typeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (Number.isInteger(value)) return 'integer'
  return typeof value
}

function matchesType(value: unknown, expected: string): boolean {
  const actual = typeOf(value)
  if (expected === 'number') return actual === 'integer' || actual === 'number'
  if (expected === 'object') return actual === 'object'
  return actual === expected
}

export function validate(
  document: unknown,
  schema: JsonSchema,
  root: JsonSchema = schema,
  path = '$',
): string[] {
  const problems: string[] = []

  const ref = schema.$ref
  if (typeof ref === 'string') {
    const target = ref.replace(/^#\//, '').split('/')
    let resolved: unknown = root
    for (const segment of target) {
      resolved = (resolved as Record<string, unknown> | undefined)?.[segment]
    }
    if (resolved === undefined) return [`${path}: cannot resolve $ref ${ref}`]
    return validate(document, resolved as JsonSchema, root, path)
  }

  if ('const' in schema && document !== schema.const) {
    problems.push(
      `${path}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(document)}`,
    )
  }

  const enumeration = schema.enum
  if (Array.isArray(enumeration) && !enumeration.includes(document)) {
    problems.push(
      `${path}: ${JSON.stringify(document)} is not one of ${JSON.stringify(enumeration)}`,
    )
  }

  const expectedType = schema.type
  if (typeof expectedType === 'string' && !matchesType(document, expectedType)) {
    problems.push(`${path}: expected ${expectedType}, got ${typeOf(document)}`)
  }
  if (
    Array.isArray(expectedType) &&
    !expectedType.some((one) => matchesType(document, String(one)))
  ) {
    problems.push(`${path}: expected one of ${expectedType.join('|')}, got ${typeOf(document)}`)
  }

  if (typeof document === 'string') {
    const minLength = schema.minLength
    if (typeof minLength === 'number' && document.length < minLength) {
      problems.push(`${path}: shorter than minLength ${minLength}`)
    }
    const maxLength = schema.maxLength
    if (typeof maxLength === 'number' && document.length > maxLength) {
      problems.push(`${path}: longer than maxLength ${maxLength}`)
    }
    const pattern = schema.pattern
    if (typeof pattern === 'string' && !new RegExp(pattern).test(document)) {
      problems.push(`${path}: ${JSON.stringify(document)} does not match ${pattern}`)
    }
  }

  if (typeof document === 'number') {
    const minimum = schema.minimum
    const maximum = schema.maximum
    if (typeof minimum === 'number' && document < minimum) {
      problems.push(`${path}: ${document} is below minimum ${minimum}`)
    }
    if (typeof maximum === 'number' && document > maximum) {
      problems.push(`${path}: ${document} is above maximum ${maximum}`)
    }
  }

  if (Array.isArray(document)) {
    const minItems = schema.minItems
    const maxItems = schema.maxItems
    if (typeof minItems === 'number' && document.length < minItems) {
      problems.push(`${path}: has ${document.length} items, minItems is ${minItems}`)
    }
    if (typeof maxItems === 'number' && document.length > maxItems) {
      problems.push(`${path}: has ${document.length} items, maxItems is ${maxItems}`)
    }
    const items = schema.items
    if (items !== undefined) {
      document.forEach((entry, index) => {
        problems.push(...validate(entry, items as JsonSchema, root, `${path}[${index}]`))
      })
    }
  }

  if (typeof document === 'object' && document !== null && !Array.isArray(document)) {
    const properties = (schema.properties ?? {}) as Record<string, JsonSchema>
    const present = Object.entries(document).filter(([, value]) => value !== undefined)

    const required = schema.required
    if (Array.isArray(required)) {
      for (const key of required) {
        if (!present.some(([name]) => name === key)) {
          problems.push(`${path}: missing required property ${String(key)}`)
        }
      }
    }

    if (schema.additionalProperties === false) {
      for (const [key] of present) {
        if (!(key in properties)) {
          problems.push(`${path}: unexpected property ${key}`)
        }
      }
    }

    for (const [key, value] of present) {
      const propertySchema = properties[key]
      if (propertySchema !== undefined) {
        problems.push(...validate(value, propertySchema, root, `${path}.${key}`))
      }
    }
  }

  return problems
}
