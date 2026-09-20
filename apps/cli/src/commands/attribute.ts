import { ATTRIBUTE_TYPES, type AttributeType } from '@retro/core'
import type { Argv } from 'yargs'
import { UsageError } from '#errors'
import { type CliRuntime, type GlobalOptions, withContext } from '#runtime'

/**
 * `attribute list`, `create`, `rename`, `retire`, `unretire` — the AI's
 * transport for the attribute vocabulary, and `label.ts`'s twin in every respect
 * that matters:
 * gated by the same switch in the same place, addressed by name for the same
 * reason, and offering no way to put a **value** on a record because that write
 * is human-only.
 *
 * Two differences, and both are the type:
 *
 * - `create` takes one, from the four the set is deliberately closed at: a few
 *   fixed types rather than an open-ended configuration surface. The choices
 *   come off the core enum rather than being spelled out again, so `--help`
 *   shows what the model will actually accept.
 * - **there is no retype**, here or anywhere. Every value already stored was
 *   accepted under the type the definition carries, and this store never
 *   rewrites what somebody wrote; retiring the attribute and creating the one
 *   you meant is the whole of the alternative, and both of those commands are
 *   right here (`attribute.model.ts`).
 */
export function registerAttributeCommand(
  cli: Argv<GlobalOptions>,
  runtime: CliRuntime,
): Argv<GlobalOptions> {
  return cli.command(
    'attribute <action> [name]',
    'Read the attribute vocabulary, or change it',
    (yargs) =>
      yargs
        .positional('action', {
          choices: ['list', 'create', 'rename', 'retire', 'unretire'] as const,
          describe: 'What to do',
        })
        .positional('name', {
          type: 'string',
          describe: 'create/rename/retire/unretire: which attribute, by name',
        })
        .option('type', {
          choices: ATTRIBUTE_TYPES,
          describe: 'create: what a value has to look like. Fixed once created',
        })
        .option('to', { type: 'string', describe: 'rename: the new name' }),
    async (args) =>
      withContext(runtime, args, async (context) => {
        const action = args.action ?? 'list'

        if (action === 'list') {
          if (args.name !== undefined) {
            throw new UsageError('attribute list takes no name; it lists the whole vocabulary')
          }

          const { attributes } = await context.app.attributes.list.execute({ actor: 'ai' })

          context.output.result(
            {
              attributes: attributes.map((attribute) => ({
                id: attribute.id,
                name: attribute.name,
                type: attribute.type,
                retiredAt: attribute.retiredAt ?? null,
                createdAt: attribute.createdAt,
              })),
            },
            () =>
              attributes
                .map(
                  (attribute) =>
                    `${attribute.name} · ${attribute.type}${
                      attribute.retiredAt === undefined ? '' : ' [retired]'
                    }`,
                )
                .join('\n') || 'No attributes.',
          )
          return
        }

        const name = args.name
        if (name === undefined) {
          throw new UsageError(`attribute ${action} needs a name, e.g. "external issue id"`)
        }

        if (action === 'create') {
          const type = args.type as AttributeType | undefined
          if (type === undefined) {
            throw new UsageError(
              `attribute create needs --type <${ATTRIBUTE_TYPES.join('|')}>; a type is fixed once and cannot be changed`,
            )
          }
          if (args.to !== undefined) {
            throw new UsageError(
              'attribute create takes no --to; the name is the positional argument',
            )
          }

          const { attribute } = await context.app.attributes.define.execute({
            actor: 'ai',
            name,
            type,
          })
          context.output.result(
            {
              id: attribute.id,
              name: attribute.name,
              type: attribute.type,
              createdAt: attribute.createdAt,
            },
            () => `Created attribute "${attribute.name}" of type ${attribute.type}`,
          )
          return
        }

        // `--type` is refused on every act that is not a create, rather than
        // ignored: a caller passing it believes the type is about to change, and
        // nothing in this system changes one — an un-retire least of all, since
        // coming back with the type it always had is exactly what makes the act
        // safe.
        if (args.type !== undefined) {
          throw new UsageError(
            `attribute ${action} takes no --type: an attribute's type is fixed when it is created, because every value already stored was accepted under it`,
          )
        }

        if (action === 'rename') {
          const to = args.to
          if (to === undefined) throw new UsageError('attribute rename needs --to <new name>')

          const { attribute } = await context.app.attributes.rename.execute({
            actor: 'ai',
            attribute: { attributeName: name },
            name: to,
          })
          context.output.result(
            { id: attribute.id, name: attribute.name },
            () =>
              `Renamed "${name}" to "${attribute.name}"; every record carrying a value now reads the new name`,
          )
          return
        }

        if (args.to !== undefined) {
          throw new UsageError(`attribute ${action} takes no --to`)
        }

        if (action === 'unretire') {
          const { attribute } = await context.app.attributes.unretire.execute({
            actor: 'ai',
            attribute: { attributeName: name },
          })
          context.output.result(
            {
              id: attribute.id,
              name: attribute.name,
              type: attribute.type,
              retiredAt: attribute.retiredAt ?? null,
            },
            () =>
              `Un-retired "${attribute.name}"; it is offered again, still of type ${attribute.type}`,
          )
          return
        }

        const { attribute } = await context.app.attributes.retire.execute({
          actor: 'ai',
          attribute: { attributeName: name },
        })
        context.output.result(
          { id: attribute.id, name: attribute.name, retiredAt: attribute.retiredAt ?? null },
          () =>
            `Retired "${attribute.name}"; it is no longer offered, the records carrying a value keep it, and \`attribute unretire "${attribute.name}"\` brings it back`,
        )
      }),
  )
}
