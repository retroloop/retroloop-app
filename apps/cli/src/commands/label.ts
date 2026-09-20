import type { Argv } from 'yargs'
import { UsageError } from '#errors'
import { type CliRuntime, type GlobalOptions, withContext } from '#runtime'

/**
 * `label list`, `label create`, `label rename`, `label retire`,
 * `label unretire` — **the AI's transport for the label vocabulary**, and the
 * surface the configuration-write switch is actually about.
 *
 * The config page carries a toggle the human can enable to give the AI the
 * ability to update the configs; while it is disabled, the human can be certain
 * the AI cannot change them.
 *
 * This file is the "AI" in that sentence. The CLI writes as the AI and only as
 * the AI — there is no `--actor` here to get wrong — so with the switch off
 * every write below is refused before it reads anything, with exit **5**
 * (`FORBIDDEN_ACTOR`, cli.md §Exit codes) and a message naming the setting and
 * saying a human turns it on. With the switch on they all work. **The check is
 * not here**: it is in core, inside the unit of work that would do the writing,
 * so the guarantee holds against this command, a hand-rolled tRPC call and
 * anything else that opens the store (`config-write.service.ts`).
 *
 * **There is deliberately no way to put a label on a record from here.** That
 * write is human-only whatever the switch says — the switch governs
 * the *configuration*, and whether the AI may ever mark up its own draft records
 * is still open. The house shape for
 * a human-only write is a use-case refusal and no CLI surface at all, which is
 * what `threads.resolve` and `review.finish` do; the one deliberate departure is
 * `record archive`, which is offered *and refused* because it sits on the same
 * command as an act the AI uses constantly. Nothing here sits beside such an act,
 * so nothing here is offered to be refused.
 *
 * **Addressed by name, not by id.** The browser lists definitions and holds ids,
 * and an id survives a rename; what an agent has in hand is the word it read in
 * `label list`, and a command that made it look the id up first would be a
 * command whose most common invocation is two. The resolve is case-insensitive,
 * the same comparison that refuses a duplicate, so `label retire Migrated` finds
 * the label the settings page created as `migrated` (`definition.service.ts`).
 *
 * **`unretire` is here because the product has it**, not because an agent
 * wanted a fourth act: the rule
 * this file follows is that the CLI offers exactly what the settings page
 * offers, and the page grew an un-retire on retired rows. It is a definition
 * write like the other three, so the same switch governs it and an exit 5 while
 * that switch is off is the same real answer.
 */
export function registerLabelCommand(
  cli: Argv<GlobalOptions>,
  runtime: CliRuntime,
): Argv<GlobalOptions> {
  return cli.command(
    'label <action> [name]',
    'Read the label vocabulary, or change it',
    (yargs) =>
      yargs
        .positional('action', {
          choices: ['list', 'create', 'rename', 'retire', 'unretire'] as const,
          describe: 'What to do',
        })
        .positional('name', {
          type: 'string',
          describe: 'create/rename/retire/unretire: which label, by name',
        })
        .option('to', { type: 'string', describe: 'rename: the new name' }),
    async (args) =>
      withContext(runtime, args, async (context) => {
        /**
         * yargs types every positional as optional and `<action>` is neither: it
         * is required and carries a `choices` list, so the parser has refused an
         * absent or unknown one before this runs. Naming the fallback is a type
         * obligation rather than a branch anybody can reach — the same shape
         * `record.ts` has.
         */
        const action = args.action ?? 'list'

        if (action === 'list') {
          if (args.name !== undefined) {
            // Refused rather than ignored: `label list migrated` is somebody
            // expecting a filter, and answering with the whole vocabulary would
            // look like the filter matched everything.
            throw new UsageError('label list takes no name; it lists the whole vocabulary')
          }

          const { labels } = await context.app.labels.list.execute({ actor: 'ai' })

          context.output.result(
            {
              labels: labels.map((label) => ({
                id: label.id,
                name: label.name,
                /**
                 * Null rather than absent, the way every optional on the wire
                 * is: a reader telling "still offered" from "the field is
                 * missing" would be branching on absence.
                 */
                retiredAt: label.retiredAt ?? null,
                createdAt: label.createdAt,
              })),
            },
            () =>
              labels
                .map((label) => `${label.name}${label.retiredAt === undefined ? '' : ' [retired]'}`)
                .join('\n') || 'No labels.',
          )
          return
        }

        const name = args.name
        if (name === undefined) {
          throw new UsageError(`label ${action} needs a name, e.g. migrated`)
        }

        if (action === 'create') {
          if (args.to !== undefined) {
            throw new UsageError('label create takes no --to; the name is the positional argument')
          }
          const { label } = await context.app.labels.define.execute({ actor: 'ai', name })
          context.output.result(
            { id: label.id, name: label.name, createdAt: label.createdAt },
            () => `Created label "${label.name}"`,
          )
          return
        }

        if (action === 'rename') {
          const to = args.to
          if (to === undefined) throw new UsageError('label rename needs --to <new name>')

          const { label } = await context.app.labels.rename.execute({
            actor: 'ai',
            label: { labelName: name },
            name: to,
          })
          context.output.result(
            { id: label.id, name: label.name },
            () =>
              // The record's labels all read the new name from this moment, because
              // a definition is written over rather than versioned — worth saying
              // in the line, because it is the one act here with a blast radius.
              `Renamed "${name}" to "${label.name}"; every record wearing it now reads the new name`,
          )
          return
        }

        if (args.to !== undefined) {
          throw new UsageError(`label ${action} takes no --to`)
        }

        if (action === 'unretire') {
          const { label } = await context.app.labels.unretire.execute({
            actor: 'ai',
            label: { labelName: name },
          })
          context.output.result(
            // `retiredAt` is null now and is still on the answer, because a
            // reader branching on the field's absence is the one thing every
            // `--json` shape in this CLI refuses to make possible.
            { id: label.id, name: label.name, retiredAt: label.retiredAt ?? null },
            () => `Un-retired "${label.name}"; it is offered again, and nothing else changed`,
          )
          return
        }

        const { label } = await context.app.labels.retire.execute({
          actor: 'ai',
          label: { labelName: name },
        })
        context.output.result(
          { id: label.id, name: label.name, retiredAt: label.retiredAt ?? null },
          () =>
            // Not a delete, and the line says so: the records that wear it go on
            // wearing it. Reversible, and
            // the line says that too — a reader who has just mis-pressed this is
            // exactly the reader who needs to know.
            `Retired "${label.name}"; it is no longer offered, the records wearing it keep it, and \`label unretire "${label.name}"\` brings it back`,
        )
      }),
  )
}
