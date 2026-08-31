import type { AttributeDefinition, NewAttributeDefinition } from '#domain/models/attribute.model'

/**
 * The attribute half of the definition pair — the same five methods a label's
 * repository has, and for the same reasons (`label-definition.repository.ts`
 * carries the argument for why definitions are mutable while everything they are
 * applied to is append-only).
 *
 * **There is no `retype`.** A rename leaves every stored value as true as it
 * was; a retype would leave values behind that were accepted under a type the
 * definition no longer claims, and this store never rewrites what somebody
 * wrote. Retiring the attribute and defining the one you meant keeps both
 * readings honest, which is the whole of the alternative (`attribute.model.ts`).
 */
export type AttributeDefinitionRepository = {
  add(definition: NewAttributeDefinition): Promise<AttributeDefinition>
  rename(id: number, name: string): Promise<AttributeDefinition>
  retire(id: number, at: string): Promise<AttributeDefinition>
  /** Clears `retiredAt`. Takes no timestamp — `label-definition.repository.ts` says why. */
  unretire(id: number): Promise<AttributeDefinition>
  findById(id: number): Promise<AttributeDefinition | undefined>
  /** Every definition there is, retired included, in minting order. */
  listAll(): Promise<readonly AttributeDefinition[]>
}
