import type { AppRouterOutputs } from '@retro/api'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useTRPC } from '@/lib/trpc'

/**
 * The settings page's body — the two vocabularies and the one switch.
 *
 * **The page exists because the definitions are global.** Labels and attributes
 * need a settings page precisely because each definition is a global thing.
 * Nothing here is scoped to a retrospective, a session or a working directory,
 * which is why it is a route of its own rather than a panel inside a review.
 *
 * **One file for both vocabularies and the switch**, because a settings page is
 * one thing a reader reads top to bottom, and three files of forty lines each
 * would put the whole of it behind three imports. What is shared between the two
 * vocabularies — the row, its rename control — is written once here; what
 * differs is the type, and it differs in exactly two places.
 *
 * **Every element earns its place**, and the list is short on purpose: create,
 * rename, retire, un-retire, plus the switch. There is no colour picker, no
 * description, no usage count, no reordering and no delete. Each of those is a
 * thing a retrospective can add once somebody has used this; a delete in
 * particular is a thing this product does not do at all — retiring keeps the
 * name readable on every record that already wears it (`label.model.ts`).
 *
 * **Un-retire is the one control a retrospective did add**
 * (`r-retire-burns-a-word`), and it is on retired rows only — see `DefinitionRow`
 * for why that is the whole of its footprint.
 */
type LabelDefinition = AppRouterOutputs['labels']['list'][number]
type AttributeDefinition = AppRouterOutputs['attributes']['list'][number]
type AttributeType = AttributeDefinition['type']

/**
 * The AI-writes promise, as a control: a toggle the human can enable to give the
 * AI the ability to update the configuration. While it is disabled, the human
 * can be certain the AI cannot touch it.
 *
 * **The switch does not enforce anything, and the sentence under it says what
 * does.** The guarantee is read in core, inside the unit of work that would do
 * the writing, so it holds against a bypassed UI, a hand-rolled call and the
 * AI's own process against the same file (`config-write.service.ts`). A page
 * that lied about this state would change nothing about what the AI can do,
 * which is exactly the property the promise needs.
 *
 * It is first on the page because it is the only thing here that is a *promise*
 * rather than a list — and because a reader who has come to find out what the AI
 * may do should not have to scroll past two vocabularies to find out.
 */
export function AiConfigWriteToggle() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const settings = useQuery(trpc.settings.get.queryOptions({}))

  const set = useMutation(
    trpc.settings.setAiConfigWrite.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: trpc.settings.pathKey() }),
    }),
  )

  const enabled = settings.data?.aiConfigWrite ?? false

  return (
    <section className="flex flex-col gap-2" data-testid="settings-ai-config-write">
      <div className="flex items-center gap-3">
        <Switch
          id="ai-config-write"
          checked={enabled}
          disabled={settings.data === undefined || set.isPending}
          data-testid="settings-ai-toggle"
          onCheckedChange={(next) => set.mutate({ enabled: next })}
        />
        <label htmlFor="ai-config-write" className="font-medium text-sm">
          Let the AI create, rename and retire labels and attributes
        </label>
      </div>

      {/**
       * The state in words as well as in the switch, because this is the one
       * control on the page whose *off* position is the interesting one — and
       * because a screen reader announcing "switch, off" says nothing about what
       * that buys. It is the same rule every tag in this app obeys: state is
       * never carried by a visual alone (`tag.tsx`).
       */}
      <p className="text-muted-foreground text-sm" data-testid="settings-ai-toggle-state">
        {enabled
          ? 'The AI can change this vocabulary. It still cannot put a label on a record, or set a value — those are yours.'
          : 'The AI cannot change this vocabulary. Its attempts are refused by the store itself, not by this page.'}
      </p>
    </section>
  )
}

export function LabelVocabulary() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const labels = useQuery(trpc.labels.list.queryOptions({}))
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: trpc.labels.pathKey() })

  const define = useMutation(trpc.labels.define.mutationOptions({ onSuccess: invalidate }))
  const rename = useMutation(trpc.labels.rename.mutationOptions({ onSuccess: invalidate }))
  const retire = useMutation(trpc.labels.retire.mutationOptions({ onSuccess: invalidate }))
  const unretire = useMutation(trpc.labels.unretire.mutationOptions({ onSuccess: invalidate }))

  return (
    <Vocabulary
      kind="label"
      /**
       * A plain framing, and it is here rather than in a tooltip because the
       * difference between the two primitives is the thing a first-time reader
       * of this page has to be told once: a label is usually just a label, and
       * an attribute is what carries the detail beside one.
       */
      blurb="A name a record wears, or does not. Nothing else travels with it."
      definitions={labels.data}
      onRename={(id, name) => rename.mutate({ id, name })}
      onRetire={(id) => retire.mutate({ id })}
      onUnretire={(id) => unretire.mutate({ id })}
      busy={rename.isPending || retire.isPending || unretire.isPending}
      refusal={define.error ?? rename.error ?? retire.error ?? unretire.error}
    >
      <CreateForm
        kind="label"
        busy={define.isPending}
        onCreate={(name) => define.mutate({ name })}
      />
    </Vocabulary>
  )
}

export function AttributeVocabulary() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const attributes = useQuery(trpc.attributes.list.queryOptions({}))
  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: trpc.attributes.pathKey() })

  const define = useMutation(trpc.attributes.define.mutationOptions({ onSuccess: invalidate }))
  const rename = useMutation(trpc.attributes.rename.mutationOptions({ onSuccess: invalidate }))
  const retire = useMutation(trpc.attributes.retire.mutationOptions({ onSuccess: invalidate }))
  const unretire = useMutation(trpc.attributes.unretire.mutationOptions({ onSuccess: invalidate }))

  const [type, setType] = useState<AttributeType>('text')

  return (
    <Vocabulary
      kind="attribute"
      blurb="A named value a record carries. The type is fixed when you create it."
      definitions={attributes.data}
      /**
       * The type is on the row and nowhere else — there is no control anywhere
       * that changes one, because every value already stored was accepted under
       * it (`attribute.model.ts`). Retiring and creating the one you meant is
       * the whole of the alternative, and both of those controls are right here.
       */
      trailing={(definition) => (
        <span className="meta-mono" data-testid="settings-attribute-type">
          {(definition as AttributeDefinition).type}
        </span>
      )}
      onRename={(id, name) => rename.mutate({ id, name })}
      onRetire={(id) => retire.mutate({ id })}
      onUnretire={(id) => unretire.mutate({ id })}
      busy={rename.isPending || retire.isPending || unretire.isPending}
      refusal={define.error ?? rename.error ?? retire.error ?? unretire.error}
    >
      <CreateForm
        kind="attribute"
        busy={define.isPending}
        onCreate={(name) => define.mutate({ name, type })}
        extra={
          <Select value={type} onValueChange={(next) => setType(next as AttributeType)}>
            <SelectTrigger size="sm" className="w-28" data-testid="settings-attribute-new-type">
              <SelectValue aria-label="Type" />
            </SelectTrigger>
            <SelectContent>
              {(['number', 'text', 'url', 'date'] as const).map((option) => (
                <SelectItem key={option} value={option} data-testid={`settings-type-${option}`}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
    </Vocabulary>
  )
}

/**
 * One vocabulary: a heading, a line saying what the primitive is, the create
 * form, and the list.
 *
 * The two callers make this a shared component rather than two copies, against
 * the repo's own two-is-a-coincidence rule (`tag.tsx`) — and the difference is
 * what is being lifted. That rule is about a **class string**, where a second
 * copy costs a line; this is a list, a popover, a disabled state and an empty
 * state, and two copies of it would be two places for the label list to grow a
 * behaviour the attribute list quietly does not have.
 */
function Vocabulary({
  kind,
  blurb,
  definitions,
  trailing,
  onRename,
  onRetire,
  onUnretire,
  busy,
  refusal,
  children,
}: {
  kind: 'label' | 'attribute'
  blurb: string
  definitions: readonly LabelDefinition[] | undefined
  trailing?: (definition: LabelDefinition) => React.ReactNode
  onRename: (id: number, name: string) => void
  onRetire: (id: number) => void
  onUnretire: (id: number) => void
  busy: boolean
  refusal: { readonly message: string } | null
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3" data-testid={`settings-${kind}s`}>
      {/**
       * The blurb, and no heading above it: the nav item that opened this panel
       * is already carrying the word "Labels" or "Attributes" a few pixels to
       * the left, and an `<h2>` repeating it would be the page naming the same
       * thing twice in one glance. The blurb stays, because it is the part a
       * first-time reader actually needs — a plain framing of what separates the
       * two primitives.
       */}
      <p className="text-muted-foreground text-sm">{blurb}</p>

      {children}

      {/**
       * **What the server said no to**, and this is the one element on the page
       * that exists because of a rule this page deliberately does not enforce.
       *
       * The name rules — length, one line, a name already taken, case-folded —
       * are the domain's, and restating them here would be a second copy free to
       * disagree with the CLI's (`definition-input.schema.ts`). The cost of not
       * restating them is that a refused write would otherwise do nothing
       * visible at all, which is worse than either. So the page sends what was
       * typed and shows the sentence that came back.
       *
       * It is the server's own message rather than one invented here, for the
       * same reason: two ways of saying "that name is taken" is one too many.
       */}
      {refusal === null ? null : (
        <p className="text-destructive text-sm" data-testid={`settings-${kind}-refusal`}>
          {refusal.message}
        </p>
      )}

      {definitions === undefined ? null : definitions.length === 0 ? (
        /**
         * **What a fresh install says**, and it is the first thing anybody ever
         * sees of this feature: the product ships no labels and no attributes —
         * none are hardcoded — so empty is the normal state rather than an
         * error. It says the one true thing and stops, exactly as the empty
         * dashboard and the empty records page do.
         */
        <p className="text-muted-foreground text-sm" data-testid={`settings-${kind}s-empty`}>
          None yet. The ones you create here are offered on every record.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5" data-testid={`settings-${kind}-list`}>
          {definitions.map((definition) => (
            <li key={definition.id}>
              <DefinitionRow
                kind={kind}
                definition={definition}
                trailing={trailing?.(definition)}
                onRename={onRename}
                onRetire={onRetire}
                onUnretire={onUnretire}
                busy={busy}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * One definition: what it is called, whether it is still offered, and the acts
 * it takes.
 *
 * **A retired row stays on the list**, dimmed and marked, and keeps its rename.
 * That is what retiring means — the records that wear it go on wearing it, and a
 * typo in a retired label is as worth fixing as one in an offerable one.
 *
 * **Retire and Un-retire are the same slot, and exactly one of them is ever
 * there** (`r-retire-burns-a-word`): a retired definition can be brought back to
 * offerable by the human — same row, same one-press shape. An offerable row
 * offers Retire; a retired row offers Un-retire; neither is ever shown
 * disabled, because a control with nothing left to do is a control that has
 * earned nothing.
 *
 * **That symmetry is the whole fix, and it is why there is still no confirm
 * dialog.** Retiring used to be one press with no way back, against a store that
 * never frees a retired name — so a mis-press burned a vocabulary word forever.
 * A confirm was the cheaper alternative and was dropped on purpose: it taxes
 * every legitimate retire to guard against the rare slip, where a second press
 * guards the slip and taxes nothing.
 */
function DefinitionRow({
  kind,
  definition,
  trailing,
  onRename,
  onRetire,
  onUnretire,
  busy,
}: {
  kind: 'label' | 'attribute'
  definition: LabelDefinition
  trailing: React.ReactNode
  onRename: (id: number, name: string) => void
  onRetire: (id: number) => void
  onUnretire: (id: number) => void
  busy: boolean
}) {
  const retired = definition.retiredAt !== null

  return (
    <div
      data-testid={`settings-${kind}-${definition.id}`}
      className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-surface px-3 py-2"
    >
      <span
        data-testid={`settings-${kind}-name`}
        className={retired ? 'text-muted-foreground text-sm line-through' : 'text-sm'}
      >
        {definition.name}
      </span>
      {trailing}
      {retired ? (
        // The word, not a colour and not the strikethrough alone — the same rule
        // every state in this app follows.
        <span className="meta-mono" data-testid={`settings-${kind}-retired`}>
          retired
        </span>
      ) : null}

      <div className="ml-auto flex items-center gap-1">
        <RenameControl
          kind={kind}
          definition={definition}
          busy={busy}
          onRename={(name) => onRename(definition.id, name)}
        />
        {retired ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            data-testid={`settings-${kind}-unretire`}
            onClick={() => onUnretire(definition.id)}
          >
            Un-retire
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            data-testid={`settings-${kind}-retire`}
            onClick={() => onRetire(definition.id)}
          >
            Retire
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * The rename, in the popover idiom the record page's resolve already uses.
 *
 * It opens on the current name, because a rename is nearly always a correction
 * to it rather than a replacement — and it closes on submit rather than on the
 * answer, for the reason every write on these pages does: the list re-reads
 * itself, and a popover that waited would be a popover the reader is holding
 * open to watch a spinner.
 */
function RenameControl({
  kind,
  definition,
  busy,
  onRename,
}: {
  kind: 'label' | 'attribute'
  definition: LabelDefinition
  busy: boolean
  onRename: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(definition.name)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // Reopening starts from what the row says now, not from what was typed
        // and abandoned last time.
        if (next) setName(definition.name)
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" disabled={busy} data-testid={`settings-${kind}-rename`}>
          Rename
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" data-testid={`settings-${kind}-rename-panel`}>
        <form
          className="flex flex-col gap-2"
          onSubmit={(event: FormEvent) => {
            event.preventDefault()
            onRename(name)
            setOpen(false)
          }}
        >
          <Input
            value={name}
            aria-label={`New name for ${definition.name}`}
            data-testid={`settings-${kind}-rename-name`}
            onChange={(event) => setName(event.target.value)}
          />
          <Button size="sm" type="submit" disabled={name.trim().length === 0}>
            Save
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}

/**
 * The create form — a name, whatever else the primitive needs, and one button.
 *
 * A `<form>` rather than an input beside a button, so Enter submits: this is a
 * field somebody types a word into and the keyboard is where they already are.
 * The button is disabled on an empty name and on nothing else — the domain's
 * other rules (length, one line, a name already taken) are the server's, and a
 * page that restated them would be a second copy free to disagree
 * (`definition-input.schema.ts`).
 */
function CreateForm({
  kind,
  busy,
  onCreate,
  extra,
}: {
  kind: 'label' | 'attribute'
  busy: boolean
  onCreate: (name: string) => void
  extra?: React.ReactNode
}) {
  const [name, setName] = useState('')

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      data-testid={`settings-${kind}-new`}
      onSubmit={(event: FormEvent) => {
        event.preventDefault()
        onCreate(name)
        setName('')
      }}
    >
      <Input
        value={name}
        placeholder={kind === 'label' ? 'migrated' : 'external issue id'}
        aria-label={`New ${kind} name`}
        data-testid={`settings-${kind}-new-name`}
        className="w-52"
        onChange={(event) => setName(event.target.value)}
      />
      {extra}
      <Button
        size="sm"
        type="submit"
        disabled={name.trim().length === 0 || busy}
        data-testid={`settings-${kind}-new-submit`}
      >
        Add
      </Button>
    </form>
  )
}
