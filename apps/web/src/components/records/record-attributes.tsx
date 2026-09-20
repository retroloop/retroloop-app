import type { AppRouterOutputs } from '@retro/api'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Reference } from '@/components/records/record-lifecycle'
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
import { useTRPC } from '@/lib/trpc'

/** A value as a record carries it — name, type and value, resolved by the server. */
export type RecordAttribute = AppRouterOutputs['records']['byId']['attributes'][number]

/**
 * The values a record carries — an "external ticket ID" on a record that went to
 * GitHub, say, which is the second half of a convention like *whenever the
 * migrated label goes on, the record also carries an attribute holding a GitHub
 * issue id*.
 *
 * **The convention belongs to the human and the system enforces none of it.**
 * Nothing here looks at what the record wears, nothing demands a value because a
 * label is on, and nothing warns when one is missing: composition is the *user's*
 * convention, never a system mechanism.
 *
 * **This page and no other.** A label is a classification and is worth a tag
 * wherever a record is listed; a value is data *about* a record, which is a
 * thing you go and look at. So the wire carries these on `records.byId` alone,
 * and there is no version of this block on a review card or a records row
 * (`views.schema.ts` §recordPageSchema).
 *
 * **Two controls, and the asymmetry is the domain's.** Setting a value needs a
 * field, so it is a popover; clearing one needs nothing, so it is a press — the
 * same split the lifecycle controls make between Resolve and the three acts that
 * cite nothing.
 */
export function RecordAttributes({
  retroId,
  rid,
  attributes,
}: {
  retroId: number
  rid: string
  attributes: readonly RecordAttribute[]
}) {
  return (
    <section className="flex flex-col gap-2" data-testid="record-attributes">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="section-label">Attributes</h2>
        <SetValue retroId={retroId} rid={rid} attributes={attributes} />
      </div>

      {attributes.length === 0 ? null : (
        <ul className="flex flex-col gap-1.5" data-testid="record-attribute-list">
          {attributes.map((attribute) => (
            <li key={attribute.id}>
              <ValueRow retroId={retroId} rid={rid} attribute={attribute} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * One value: what it is called, what it says, and the one act it takes.
 *
 * A `url` renders through the same `Reference` the resolve's evidence uses, so a
 * web address is a link and everything else is the text it is — one question
 * with an unambiguous answer, asked the same way in both places, which is what
 * makes "a url attribute is a link" true by construction rather than by two
 * rules that happen to agree (`record-lifecycle.tsx` §Reference).
 *
 * The type is beside the name because it is what the reader has to know to type
 * the next one — and because a retired attribute is one nobody can set again,
 * which the row says in the word rather than by leaving the value looking odd.
 */
function ValueRow({
  retroId,
  rid,
  attribute,
}: {
  retroId: number
  rid: string
  attribute: RecordAttribute
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const clear = useMutation(
    trpc.attributes.set.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: trpc.records.pathKey() }),
    }),
  )

  return (
    <div
      data-testid={`record-attribute-${attribute.id}`}
      className="flex flex-wrap items-center gap-2 rounded-md border border-hairline bg-surface px-3 py-2"
    >
      <span className="section-label" data-testid="record-attribute-name">
        {attribute.name}
      </span>
      <span className="meta-mono" data-testid="record-attribute-type">
        {attribute.type}
      </span>
      {attribute.retired ? (
        <span className="meta-mono" data-testid="record-attribute-retired">
          retired
        </span>
      ) : null}

      <span className="min-w-0 flex-1" data-testid="record-attribute-value">
        {attribute.type === 'url' ? (
          <Reference reference={attribute.value} />
        ) : (
          <span className="break-words text-sm">{attribute.value}</span>
        )}
      </span>

      {/* One press, no composer: clearing sends no value at all, which is the
          act rather than a field left blank. There is no confirm, because
          nothing here is terminal — every act appends a version and a mis-press
          costs one more press. */}
      <Button
        variant="ghost"
        size="sm"
        disabled={clear.isPending}
        data-testid="record-attribute-clear"
        onClick={() => clear.mutate({ retroId, rid, attributeId: attribute.id })}
      >
        Clear
      </Button>
    </div>
  )
}

/**
 * Setting a value: which attribute, and what it says.
 *
 * **One control for both setting and changing**, rather than an Add here and an
 * Edit on every row. A value is an assignment — the domain lets the same one be
 * re-asserted and lets a different one replace it — so "set the external issue
 * id" is one act whether or not the record already carries one, and two controls
 * would be two names for it.
 *
 * The picker offers every **offerable** attribute and nothing else. A retired
 * one is missing on purpose: the server refuses a set against one, and the row
 * above still offers Clear for a value already carried — the same asymmetry the
 * labels control makes, and for the same reason.
 */
function SetValue({
  retroId,
  rid,
  attributes,
}: {
  retroId: number
  rid: string
  attributes: readonly RecordAttribute[]
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const vocabulary = useQuery(trpc.attributes.list.queryOptions({}))

  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState('')
  const [value, setValue] = useState('')

  const set = useMutation(
    trpc.attributes.set.mutationOptions({
      onSuccess: () => {
        setOpen(false)
        setChosen('')
        setValue('')
        void queryClient.invalidateQueries({ queryKey: trpc.records.pathKey() })
      },
    }),
  )

  const offered = (vocabulary.data ?? []).filter((definition) => definition.retiredAt === null)
  const carried = new Map(attributes.map((attribute) => [String(attribute.id), attribute.value]))

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) return
        // Opening starts blank, and choosing an attribute below fills the field
        // with whatever the record already carries — because changing a value is
        // nearly always an edit to it rather than a replacement.
        setChosen('')
        setValue('')
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" data-testid="record-attribute-set">
          Set a value
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" data-testid="record-attribute-panel" className="w-72">
        {offered.length === 0 ? (
          <p className="text-muted-foreground text-sm" data-testid="record-attribute-none">
            No attributes yet. Create them on the settings page.
          </p>
        ) : (
          <>
            <Select
              value={chosen}
              onValueChange={(next) => {
                setChosen(next)
                setValue(carried.get(next) ?? '')
              }}
            >
              <SelectTrigger size="sm" data-testid="record-attribute-pick">
                <SelectValue aria-label="Attribute" placeholder="Which attribute" />
              </SelectTrigger>
              <SelectContent>
                {offered.map((definition) => (
                  <SelectItem
                    key={definition.id}
                    value={String(definition.id)}
                    data-testid={`record-attribute-option-${definition.id}`}
                  >
                    {definition.name} · {definition.type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              value={value}
              aria-label="Value"
              data-testid="record-attribute-value-input"
              onChange={(event) => setValue(event.target.value)}
            />

            {/**
             * The refusal, verbatim from the server — the light validation each
             * type carries is the domain's, and a page that restated the four
             * rules would be a second copy free to disagree with the CLI's
             * (`definition-input.schema.ts`). What the page owes the reader is
             * the sentence that came back, because a refused write that did
             * nothing visible would be worse than either.
             */}
            {set.error === null ? null : (
              <p className="text-destructive text-sm" data-testid="record-attribute-refusal">
                {set.error.message}
              </p>
            )}

            <div className="flex gap-2">
              {/**
               * Disabled until there is an attribute and something to put in it,
               * and on nothing else. What the value has to *look like* is the
               * definition's type and the server's rule; a page that restated
               * the four of them would be a second copy free to disagree
               * (`definition-input.schema.ts`), and the refusal it would be
               * guarding against is one the reader can simply be shown.
               */}
              <Button
                size="sm"
                data-testid="record-attribute-save"
                disabled={chosen === '' || value.trim().length === 0 || set.isPending}
                onClick={() =>
                  set.mutate({
                    retroId,
                    rid,
                    attributeId: Number(chosen),
                    value,
                  })
                }
              >
                Save
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
