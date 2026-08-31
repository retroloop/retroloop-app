import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { AppShell } from '@/components/chrome/app-shell'
import { Appearance } from '@/components/settings/appearance'
import {
  AiConfigWriteToggle,
  AttributeVocabulary,
  LabelVocabulary,
} from '@/components/settings/vocabulary'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { APP_NAME } from '@/lib/app-name'
import { useTRPC } from '@/lib/trpc'

export const Route = createFileRoute('/settings')({ component: SettingsPage })

/**
 * The one page in this product that is about the product rather than about a
 * retrospective — and it exists because the owner's ruling made it necessary:
 *
 * > *"to keep it flexible we will not hardcode any labels or attributes … Note
 * > that adding those will require setting up a settings page, because each
 * > label or attribute is going to be a global thing."*
 *
 * **A left nav of sections with the content on the right, since session 12**, on
 * his word (retro-13 `r-settings-vertical-tabs`): *"I want the settings page to
 * be like this — this is another tool. shadcn comes with vertical tabs, use that
 * to implement something like this."* The reference he attached is
 * the shape a reader already knows from every settings screen they use: a
 * standing list of section names, the current one highlighted, one panel beside
 * it.
 *
 * **The counted chip row it replaces was the session-11 bake-off winner's
 * mechanism, and he retired it in the same verdict** — three lanes staked three
 * different shapes and none of them was the one he had in mind, which is the
 * whole of retro-13 record 9. The chips are gone rather than kept as a narrow
 * fallback: two mechanisms for choosing the same four panels would be one too
 * many, and a responsive layout that changes mechanism is a page that has to be
 * learned twice.
 *
 * **Deliberately absent**, on the every-element-earns-its-place rule: no stage
 * or server settings (`retro doctor` is where those live and they are the
 * CLI's), no export configuration, no usage counts beside a definition, no
 * reordering, and no delete. A delete is not a thing this product does at all —
 * retiring is what keeps a name readable on the records that already wear it,
 * and since session 12 it is reversible rather than permanent
 * (`vocabulary.tsx`).
 *
 * The two vocabularies are two sections rather than one table with a "kind"
 * column, which is the owner's ruling made visible: labels and attributes are
 * pure and independent, and *"composition is the USER'S convention … never a
 * system mechanism"*. A single table would be the first place a reader looked
 * for the pairing the system does not have.
 */
function SettingsPage() {
  return (
    <AppShell crumbs={[{ label: APP_NAME, to: '/' }, { label: 'Settings' }]}>
      {/**
       * `wide:max-w-[48rem]` — the record page's own reading column, and the
       * same measure for the same reason: the page grows to 1536px at `wide` to
       * make room for a review's three columns, and a form handed all of it is a
       * form whose label and its control are half a screen apart. It sits at the
       * left, because the whole of the owner's width rule is that content starts
       * where content starts.
       *
       * The nav is inside that measure rather than outside it, so the reading
       * column keeps its width and the section list travels with the content
       * it switches. A nav pinned to the viewport edge would put the two ends of
       * one object at the two ends of the screen.
       */}
      <div className="flex min-w-0 flex-col gap-8 wide:max-w-[48rem]">
        <SettingsSections />
      </div>
    </AppShell>
  )
}

type Section = 'general' | 'appearance' | 'labels' | 'attributes'

/**
 * The four sections, and the vertical nav that chooses between them.
 *
 * **General is first, by his word** (retro-13 `r-general-first`): *"General
 * needs to be the first item in the list."* The order that shipped
 * before — the two vocabularies, then General — had a rationale that has since
 * stopped being true: it was scroll-distance reasoning from the single-page
 * layout, where the switch had to come before two lists nobody should have to
 * scroll past. Behind a section list there is no scroll distance to reason
 * about, so his convention wins outright and nothing argues with it.
 *
 * **Appearance is second, and it is a section of its own on his ruling** —
 * *"appearance is another tab of its own, like general etc."* It could have been
 * two more rows inside General; it is not, because General is where the
 * product's *permissions* live and Appearance is where the reader's own
 * preference does, and folding one into the other would make the page's first
 * section mean two unrelated things.
 *
 * **General holds one switch and is honest about it.** There is no filler here:
 * every element earns its place, and a settings section that says one true thing
 * is better than one padded until it looks substantial.
 *
 * **Which section is open lives in local state and deliberately not in the
 * URL.** A settings section is not a location anyone sends anyone: the
 * vocabularies are short lists a human edits in place and leaves, and there is
 * no scenario in which the useful thing to paste into a message is "the
 * attributes section" rather than a label's name. So `/settings` stays one route
 * with no search param to validate and no history entry per press — which also
 * keeps it out of the way of the validateSearch police-at-point-of-use sweep
 * (retro-13 #17), whose surfaces are the ones that *do* read a search param.
 *
 * Radix `Tabs` underneath at `orientation="vertical"`, which is the shadcn
 * vertical-tabs pattern he named: the keyboard contract — roving focus, up/down
 * arrows, Home/End, `aria-selected` — is not worth reimplementing by hand, and
 * `ui/tabs.tsx` already says so.
 */
function SettingsSections() {
  const trpc = useTRPC()
  const [section, setSection] = useState<Section>('general')

  /**
   * The counts, from the same two queries the panels themselves run — React
   * Query serves both readers from one cache entry per key, so the nav costs no
   * extra round trip and cannot disagree with the list it is counting.
   */
  const labels = useQuery(trpc.labels.list.queryOptions({}))
  const attributes = useQuery(trpc.attributes.list.queryOptions({}))

  return (
    <Tabs
      orientation="vertical"
      value={section}
      onValueChange={(next) => setSection(next as Section)}
      data-testid="settings-sections"
    >
      {/**
       * `w-44 shrink-0` — the nav is a fixed column and the panel takes the
       * rest, which is what keeps the content's left edge in one place as the
       * reader moves between sections. A nav sized to its longest name would
       * shift the whole page every time the label count crossed a digit.
       */}
      <TabsList className="w-44 shrink-0" data-testid="settings-nav">
        <SectionTab value="general" label="General" />
        <SectionTab value="appearance" label="Appearance" />
        <SectionTab value="labels" label="Labels" count={labels.data?.length} />
        <SectionTab value="attributes" label="Attributes" count={attributes.data?.length} />
      </TabsList>

      <div className="min-w-0 flex-1">
        <TabsContent value="general">
          <AiConfigWriteToggle />
        </TabsContent>
        <TabsContent value="appearance">
          <Appearance />
        </TabsContent>
        <TabsContent value="labels">
          <LabelVocabulary />
        </TabsContent>
        <TabsContent value="attributes">
          <AttributeVocabulary />
        </TabsContent>
      </div>
    </Tabs>
  )
}

/**
 * One section in the nav: its name, and its count if it has one.
 *
 * **The count is parenthesised, and that is a rule rather than a choice here**
 * (retro-13 `r-bracketed-counts`): *"if labels are to have a count the count
 * needs to be in brackets — like 'Labels (1)' instead of 'Labels 1'."* The
 * brackets are what make the number read as an annotation on the name rather
 * than as part of it; the typographic separation this replaced — a lighter,
 * spaced number — said the same thing in a channel he does not read it in.
 *
 * **It is one formatting site on purpose.** Every counted navigation item in
 * this product goes through here or through something that copies this line, so
 * the rule generalises the way he stated it rather than being re-decided per
 * surface.
 *
 * The count recedes rather than disappearing at zero, which is `CountsBar`'s
 * rule in harbor and the records filter's rule here: a vocabulary nobody has
 * created anything in yet reads "Labels (0)", and that is a fact about the store
 * rather than an absence of one. General and Appearance carry no count at all,
 * and the asymmetry is honest — they hold controls, not lists, and a number
 * there would be counting nothing a reader cares about.
 */
function SectionTab({
  value,
  label,
  count,
}: {
  value: Section
  label: string
  count?: number | undefined
}) {
  return (
    <TabsTrigger value={value} data-testid={`settings-tab-${value}`}>
      {countedLabel(label, count)}
    </TabsTrigger>
  )
}

/**
 * **The one place a counted navigation item is spelled**, and the reason it is a
 * string rather than a name beside a styled `<span>`: the brackets are part of
 * the item's text, so the whole literal — `Labels (3)` — is one thing a reader
 * sees and one thing a scenario can assert. Split across two elements the
 * separator becomes a `gap` in the layout, which reads correctly on screen and
 * puts `Labels(3)` in the DOM, where an assertion for his literal would have to
 * be written against something other than what he asked for.
 */
function countedLabel(label: string, count: number | undefined): string {
  return count === undefined ? label : `${label} (${count})`
}
