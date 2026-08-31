import { DomainError, type DomainErrorCode } from '#domain/errors/domain.error'
import type { Actor } from '#domain/models/actor.model'
import { AI_CONFIG_WRITE, SETTING_ON, type SettingEntry } from '#domain/models/setting.model'
import type { SettingRepository } from '#domain/repositories/setting.repository'

/**
 * **The owner's certainty, expressed as one function every definition write
 * calls.** OWNER RULING 2, dictated:
 *
 * > *"In the config page add a toggle that the user can enable to give the AI
 * > the ability to update the configs. Otherwise, if it is disabled, the user
 * > can be certain that the AI cannot mess around."*
 *
 * Three properties, and every one of them is what *certainty* means rather than
 * a preference about where code goes:
 *
 * 1. **It is read in core, at the store boundary, inside the unit of work that
 *    would do the writing.** Not in the settings page, not in a tRPC
 *    middleware, not in the CLI's argument parsing — all three of those can be
 *    bypassed by anything that opens the store, and the AI runs in its own
 *    process against the same SQLite file (KC-0004). Reading the setting inside
 *    the same `tx` as the write also closes the window where the human turns
 *    the toggle off while a write is in flight.
 * 2. **Off is the default and no row says so.** A fresh install has never
 *    written a settings row, and `undefined` reads as off — so the safe state is
 *    the state a store is born in, and turning the guarantee on is something
 *    somebody had to do. Nothing is inferred from silence except the answer that
 *    refuses (KC-0010).
 * 3. **It refuses `ai` and says nothing about `human`.** The human writes
 *    definitions whatever the toggle says; the toggle is about the AI, which is
 *    the whole of what he asked for.
 */
export function aiConfigWriteEnabled(entry: SettingEntry | undefined): boolean {
  return entry?.value === SETTING_ON
}

/**
 * The guard itself. Every use case that writes a label or attribute **definition**
 * calls this as its first act inside the transaction, so the rule cannot be
 * routed around by arriving over a different transport.
 *
 * It is a `ForbiddenActorError` — code `FORBIDDEN_ACTOR`, `FORBIDDEN` on the
 * wire, exit 5 on the CLI (`cli.md` §Exit codes) — because the question it
 * answers is "may this actor do this", which is what that code is for. A
 * `ConflictError` would say the store was in the wrong state for an act anyone
 * could take, and that is not what happened: the human can take this act right
 * now.
 *
 * It deliberately does **not** govern applying a label or setting an attribute
 * value on a record. Those are human-only this session whatever the toggle says
 * (`record-label.model.ts`), because the toggle is about the global
 * configuration — *"the ability to update the configs"* — and whether the AI may
 * ever mark up its own draft records is one of the opens his ruling did not
 * reach.
 */
export async function assertAiMayWriteDefinitions(
  settings: SettingRepository,
  actor: Actor,
  what: string,
): Promise<void> {
  if (actor === 'human') return

  if (!aiConfigWriteEnabled(await settings.findLatest(AI_CONFIG_WRITE))) {
    throw new AiConfigWriteDisabledError(what)
  }
}

/**
 * The refusal the AI transport gets while the toggle is off.
 *
 * **Its own class rather than a `ForbiddenActorError`**, because that error's
 * sentence — *"X is written by the human actor; ai may not perform it"* — would
 * be a lie here: with the toggle on the AI may perform it, and a message saying
 * otherwise sends the reader looking for a rule that does not exist. This one
 * names the setting and says who can move it, which is the only thing the reader
 * can act on.
 *
 * It carries `FORBIDDEN_ACTOR` as its code deliberately. Every map from a domain
 * code to a transport's vocabulary already handles that one — FORBIDDEN on the
 * wire, exit 5 on the CLI — so the guarantee arrives correctly at both without a
 * single map growing a branch it could get wrong, and the maps are keyed on the
 * code rather than on the class, which is what makes that safe.
 */
export class AiConfigWriteDisabledError extends DomainError {
  override readonly code: DomainErrorCode = 'FORBIDDEN_ACTOR'

  constructor(readonly what: string) {
    super(
      `${what} is refused: the AI may not write label or attribute definitions while ` +
        `the "${AI_CONFIG_WRITE}" setting is off. A human turns it on from the settings page.`,
    )
  }
}
