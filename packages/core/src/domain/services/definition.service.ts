import type { AttributeDefinition } from '#domain/models/attribute.model'
import type { LabelDefinition } from '#domain/models/label.model'
import type { AttributeDefinitionRepository } from '#domain/repositories/attribute-definition.repository'
import type { LabelDefinitionRepository } from '#domain/repositories/label-definition.repository'

/**
 * The rules both definition kinds share, written once.
 *
 * Labels and attributes are **pure and independent primitives** — the owner's
 * ruling is explicit that composing them is the user's convention and never a
 * system mechanism — and nothing here couples them. What this file holds is the
 * handful of rules that are the *same shape* on both sides because a definition
 * is a definition: how it is addressed, whether it is still offerable, and
 * whether its name is already taken. Two copies of each would be two chances for
 * the settings page to refuse a duplicate label and accept a duplicate
 * attribute.
 */
export type Definition = {
  readonly id: number
  readonly name: string
  readonly retiredAt: string | undefined
}

/**
 * How the adapters address a definition: by its own id, or by name.
 *
 * The pair exists for the same reason `RetroRef` does (`reference.service.ts`) —
 * two transports hold two different handles. The browser lists definitions and
 * therefore holds ids, and an id survives a rename, so the wire takes one. The
 * CLI is what the AI drives, and what an agent has in hand is the word it read
 * in `retro label list`; a command that made it look an id up first would be a
 * command whose most common invocation is two.
 *
 * Resolving by name uses the same case-insensitive comparison that refuses a
 * duplicate, so `retro label rename Migrated` finds the label the settings page
 * created as `migrated` — the two rules are one rule, which is the point of
 * their both being in this file.
 */
export type LabelRef = { readonly labelId: number } | { readonly labelName: string }
export type AttributeRef = { readonly attributeId: number } | { readonly attributeName: string }

/**
 * Whether two definition names are the same name.
 *
 * **Case-insensitive, and in the domain rather than in a collation.** A store
 * holding `Migrated` and `migrated` as two labels is a store whose settings page
 * shows two rows a reader cannot tell apart and whose filter splits one
 * classification in half. SQLite could enforce it with `COLLATE NOCASE`, and
 * that was the alternative: it folds ASCII only, the memory adapter would have
 * had to reimplement exactly that folding to keep the contract suite honest, and
 * the first non-ASCII label name in either store would have made the two
 * disagree. Deciding it here means both stores answer identically by
 * construction, and the table's plain `UNIQUE (name)` stays as the L1 backstop
 * for the exact-match case.
 *
 * `toLowerCase` rather than `localeCompare` with sensitivity options: the
 * comparison must not depend on the machine's locale, because the same store
 * gets opened by the CLI, the server and a test runner.
 */
export function sameName(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

/** Whether a definition is still on the list of things anyone can apply next. */
export function isOfferable(definition: Definition): boolean {
  return definition.retiredAt === undefined
}

/**
 * The definition already using this name, if any — **retired ones included**.
 *
 * Retired names are still taken, and that is deliberate: a retired label is
 * still rendering on every record that wears it, so a second label reusing the
 * word would make two different classifications read as one thing on the same
 * page. Retiring is how you stop offering a label, not how you free its name.
 *
 * `except` is the definition being renamed, which must not collide with itself —
 * renaming `migrated` to `Migrated` is a case correction and is allowed.
 */
export function definitionNamed<T extends Definition>(
  definitions: readonly T[],
  name: string,
  except?: number,
): T | undefined {
  return definitions.find(
    (definition) => definition.id !== except && sameName(definition.name, name),
  )
}

export async function resolveLabel(
  labels: LabelDefinitionRepository,
  ref: LabelRef,
): Promise<LabelDefinition | undefined> {
  if ('labelId' in ref) return labels.findById(ref.labelId)
  return (await labels.listAll()).find((label) => sameName(label.name, ref.labelName))
}

export async function resolveAttribute(
  attributes: AttributeDefinitionRepository,
  ref: AttributeRef,
): Promise<AttributeDefinition | undefined> {
  if ('attributeId' in ref) return attributes.findById(ref.attributeId)
  return (await attributes.listAll()).find((attribute) =>
    sameName(attribute.name, ref.attributeName),
  )
}

/** Human-readable form of a reference, for error messages. */
export function describeLabelRef(ref: LabelRef): string | number {
  return 'labelId' in ref ? ref.labelId : ref.labelName
}

export function describeAttributeRef(ref: AttributeRef): string | number {
  return 'attributeId' in ref ? ref.attributeId : ref.attributeName
}
