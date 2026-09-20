import { Fragment, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The one renderer for authored prose (`r-prose-renders-raw`).
 *
 * Every prose field on a record — and every comment — is *written* as markdown
 * and was being shown as its own source: `**bold**` put its asterisks on the
 * page, single newlines collapsed, and a list was a run-on line. A record is
 * read by skimming its bold leads, and for three retrospectives that method had
 * nothing to skim.
 *
 * **The subset is the whole contract**, and it is small because a reviewer is
 * reading a record rather than a document:
 *
 * - paragraphs, separated by a blank line
 * - a newline *inside* one is a soft wrap: the line continues whatever is open
 * - `**bold**` and `` `inline code` ``
 * - `- ` bullet lists and `1. ` numbered lists, one level of nesting
 * - `> ` blockquotes, holding the same subset again
 * - triple-backtick fences, kept whole and never read
 *
 * Anything else is text. A heading, a link, a table, an unpaired `**`, an HTML
 * tag — all of it reaches the reader as the characters the author typed, because
 * the renderer never hands a string to the DOM as markup: it parses, then builds
 * React elements, and React escapes what it puts in them. There is deliberately
 * no `dangerouslySetInnerHTML` anywhere in this file and no way to reach one
 * from it — which is why the scenario asserts the *tags that were built*, not
 * just that today's fixture came out looking right.
 *
 * A blockquote is presentation and nothing more, like every other construct
 * here: it opens no HTML path, and what is inside one is read by this same
 * function, so a quote can hold exactly what a document can and nothing else.
 *
 * **A newline inside a block is a soft wrap, not a boundary**
 * (`r-hard-wrap-breaks-prose`). Every newline used to be structural, so a line
 * that did not open with a marker was a new block: a bullet wrapped at 72
 * columns — which is the house habit for every other text surface — shattered
 * into a bullet followed by bare paragraphs, and a `**` that opened on one line
 * and closed on the next put its asterisks on the page. Both are one bug, and it
 * showed on the very first thread reply: the text simply read as broken. So a
 * line that opens no block marker continues the block above it, which is
 * CommonMark's soft break and is what makes a wrapped bullet one bullet and
 * lets an inline mark cross an authored line break. A blank line is still the
 * paragraph boundary, and a real bullet still starts with `- `, so nothing an
 * author meant as a break was taken from them.
 *
 * **Two things never reach this renderer at all**, both deliberately:
 *
 * - **The footprint** is a drawing rather than prose — an author-aligned file
 *   tree whose columns are made of runs of spaces — so `record-card.tsx` shows
 *   it preformatted. Reading its indentation as list structure is exactly the
 *   wrong thing to do to it.
 * - **Human words**, verbatim and cleaned alike, are what the human said. They
 *   get their line breaks back and nothing else; a parser run over a quote would
 *   edit the person being quoted.
 */

/**
 * Every marker this grammar reads, written the way an author types it.
 *
 * **The twin of SKILL.md's subset list** (`r-subset-renderer-drift`). The skill
 * is the authoring contract every record is written against and this file is
 * the implementation of it — two copies of one contract, and until this
 * enumeration existed nothing held them together: a deliberate plant that
 * changed the documented blockquote marker from `> ` to `>> ` left seventeen
 * skill tests and every web test green, so the skill could document a marker
 * the renderer rejects and records authored to it would render as literal text
 * with no red anywhere. The skill ships to other repositories, so the drift
 * would have been exported with it.
 *
 * `apps/cli/test/skill.test.ts` holds the two against each other in both
 * directions and fails by name — a marker documented that nothing here reads,
 * or read here and documented nowhere. It reads this list out of this file's
 * *source* rather than importing it, because `apps/cli` and `apps/web` are
 * siblings and neither may import the other (repo-layout.md); the same test
 * already reads SKILL.md and the root package.json the same way.
 *
 * The regexes below are what actually do the reading, and they stay regexes
 * because a `- ` that tolerates more spaces and a numbered line whose digits
 * vary are not expressible as the characters an author types. Keeping the two
 * beside each other is the point: this is the list, and it is directly above
 * the patterns it names.
 */
export const PROSE_MARKERS = {
  strong: '**',
  code: '`',
  bullet: '- ',
  number: '1. ',
  quote: '> ',
  fence: '```',
} as const

const BULLET = /^- +/
const NUMBER = /^\d+\. +/
/**
 * A quote line. The space after the `>` is optional, because a quote line with
 * nothing on it is written `>` and is the paragraph break inside one.
 */
const QUOTE = /^> ?/
/** An opener may carry a language hint, which nothing here does anything with. */
const FENCE_OPEN = /^```/
const FENCE_CLOSE = /^```+$/
/** A tab is four columns, so an indent can be counted in one unit. */
const TAB_COLUMNS = 4
/** What it takes to be a sub-point of the item above. */
const NESTING_INDENT = 2

/** The two inline marks, taking their characters from the enumeration above. */
const MARKS = { strong: PROSE_MARKERS.strong, code: PROSE_MARKERS.code } as const
type Mark = keyof typeof MARKS
const EVERY_MARK: readonly Mark[] = ['strong', 'code']

type Inline =
  | { readonly key: string; readonly kind: 'text'; readonly text: string }
  | { readonly key: string; readonly kind: 'code'; readonly text: string }
  | { readonly key: string; readonly kind: 'strong'; readonly children: readonly Inline[] }

type ListKind = 'bullets' | 'numbers'

/**
 * A list item, and whatever hangs off it. `nested` is a list of lists rather
 * than one because a sub-point written `- ` and one written `1. ` are two
 * lists, and merging them would render one of them under the other's marker.
 */
type Item = {
  readonly key: string
  readonly inline: readonly Inline[]
  readonly nested: readonly List[]
}

type List = { readonly key: string; readonly kind: ListKind; readonly items: readonly Item[] }

/** A fenced block, kept as the string it was written as. Nothing parses it. */
type Fence = { readonly key: string; readonly kind: 'fence'; readonly code: string }

/**
 * A quote, holding whatever the subset makes of the lines inside it.
 *
 * It holds *blocks* rather than lines because the thing it exists for is a
 * quoted list: the reply convention replays the comment being answered as
 * cleaned bullets with bold leads, inside the quote
 * (`r-reply-replay-convention`). A quote that could only hold a paragraph would
 * put the dashes of those bullets on the page.
 */
type Quote = { readonly key: string; readonly kind: 'quote'; readonly blocks: readonly Block[] }

type Block =
  | { readonly key: string; readonly kind: 'paragraph'; readonly inline: readonly Inline[] }
  | List
  | Fence
  | Quote

/**
 * Keys come from the parse rather than from a render-time index, because the
 * parse is where these nodes acquire identity. One counter per document; the
 * numbers mean nothing beyond "not the same node as that one".
 */
type Keyer = () => string

function inlineOf(source: string, allowed: readonly Mark[], key: Keyer): readonly Inline[] {
  const nodes: Inline[] = []
  let rest = source

  while (rest.length > 0) {
    let found: { readonly mark: Mark; readonly at: number; readonly end: number } | undefined

    for (const mark of allowed) {
      const token = MARKS[mark]
      const at = rest.indexOf(token)
      if (at === -1) continue
      const end = rest.indexOf(token, at + token.length)
      // An unpaired marker is not a marker, and neither is an empty pair: `**`
      // the author typed and never closed is two asterisks they meant, and the
      // reader sees them.
      if (end === -1 || end === at + token.length) continue
      // Earliest opener wins, which is what makes a `**` inside backticks part
      // of the code rather than the start of something bold.
      if (found === undefined || at < found.at) found = { mark, at, end }
    }

    if (found === undefined) {
      nodes.push({ key: key(), kind: 'text', text: rest })
      break
    }

    if (found.at > 0) nodes.push({ key: key(), kind: 'text', text: rest.slice(0, found.at) })

    const token = MARKS[found.mark]
    const inner = rest.slice(found.at + token.length, found.end)
    nodes.push(
      found.mark === 'code'
        ? // Code is literal all the way down: that is what marking it as code means.
          { key: key(), kind: 'code', text: inner }
        : {
            key: key(),
            kind: 'strong',
            children: inlineOf(
              inner,
              allowed.filter((candidate) => candidate !== 'strong'),
              key,
            ),
          },
    )

    rest = rest.slice(found.end + token.length)
  }

  return nodes
}

/**
 * The blocks are built by mutation, holding the source text they have collected
 * so far, and sealed into `Block`s once the last line is in.
 *
 * Text rather than parsed inline nodes, because a soft-wrapped block is not
 * whole until its last line has arrived: a `**` that opens on one line and
 * closes on the next is only a pair once the two are one string, and parsing
 * line by line is exactly what put those asterisks on the page.
 */
type OpenParagraph = { key: string; kind: 'paragraph'; text: string }
type OpenList = { key: string; kind: ListKind; items: OpenItem[] }
type OpenItem = { key: string; text: string; nested: OpenList[] }

/** How many columns of indentation a line opens with. */
function indentOf(line: string): number {
  let columns = 0
  for (const character of line) {
    if (character === ' ') columns += 1
    else if (character === '\t') columns += TAB_COLUMNS
    else break
  }
  return columns
}

function blocksOf(source: string, key: Keyer): readonly Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: (OpenParagraph | OpenList | Fence | Quote)[] = []
  let open: OpenParagraph | OpenList | undefined
  /**
   * The item a wrapped line belongs to, which is the last one *opened* rather
   * than the last one in `open.items`: a continuation under a sub-point belongs
   * to the sub-point, and the nested list it lives in is not the open one.
   */
  let item: OpenItem | undefined

  for (let at = 0; at < lines.length; at += 1) {
    const raw = lines[at] ?? ''
    const line = raw.trimEnd()

    // A fence is the one place inside prose where nothing is read: what sits
    // between the two lines is the content, whitespace included, and an
    // asterisk or a tag in there is a character the author typed.
    if (FENCE_OPEN.test(line.trimStart())) {
      const closes = lines.findIndex(
        (candidate, index) => index > at && FENCE_CLOSE.test(candidate.trim()),
      )
      // An unclosed fence is not a fence, for the same reason an unpaired `**`
      // is not bold: the rest of the record is prose the author wrote, not
      // something to be swallowed into a code block by one stray line.
      if (closes !== -1) {
        blocks.push({ key: key(), kind: 'fence', code: lines.slice(at + 1, closes).join('\n') })
        open = undefined
        item = undefined
        at = closes
        continue
      }
    }

    // A quote runs for as long as its lines keep saying `>`. What is inside it
    // is the same subset again, read from the lines with their markers taken
    // off — which is what makes a quoted list a list, and it is the whole point
    // of having quotes at all (`r-reply-replay-convention`). Nothing new is
    // reachable in there: it is this function, so a quote can hold exactly what
    // a document can, an unclosed fence is still not a fence, and no path opens
    // to anything outside the subset.
    if (QUOTE.test(line)) {
      const quoted: string[] = []
      let last = at
      while (last < lines.length && QUOTE.test((lines[last] ?? '').trimEnd())) {
        quoted.push((lines[last] ?? '').trimEnd().replace(QUOTE, ''))
        last += 1
      }
      blocks.push({ key: key(), kind: 'quote', blocks: blocksOf(quoted.join('\n'), key) })
      open = undefined
      item = undefined
      at = last - 1
      continue
    }

    // A blank line ends whatever was open. It is the only block boundary a line
    // that opens no marker can make: a newline on its own is a soft wrap, and
    // the line after it continues what the line before it started.
    if (line.trim().length === 0) {
      open = undefined
      item = undefined
      continue
    }

    const indent = indentOf(line)
    const body = line.trimStart()
    const bullet = BULLET.exec(body)
    const number = bullet === null ? NUMBER.exec(body) : null
    const marker = bullet ?? number

    if (marker === null) {
      // A wrapped bullet is still that bullet: the line joins the item above it
      // rather than falling out of the list as a bare paragraph.
      if (item !== undefined) {
        item.text += ` ${body}`
        continue
      }
      if (open === undefined || open.kind !== 'paragraph') {
        open = { key: key(), kind: 'paragraph', text: body }
        blocks.push(open)
        continue
      }
      open.text += ` ${body}`
      continue
    }

    const kind: ListKind = bullet !== null ? 'bullets' : 'numbers'
    const opened: OpenItem = {
      key: key(),
      text: body.slice((marker[0] ?? '').length),
      nested: [],
    }
    item = opened

    // Indented under an item that exists: the sub-point its author meant. One
    // level only — indenting further lands here too, which is a stated limit
    // rather than a silent reinterpretation. An indented bullet with nothing
    // above it is a top-level bullet, because dropping it would be worse.
    const parent =
      indent >= NESTING_INDENT && open !== undefined && open.kind !== 'paragraph'
        ? open.items.at(-1)
        : undefined

    if (parent !== undefined) {
      let into = parent.nested.at(-1)
      if (into === undefined || into.kind !== kind) {
        into = { key: key(), kind, items: [] }
        parent.nested.push(into)
      }
      into.items.push(opened)
      continue
    }

    if (open === undefined || open.kind !== kind) {
      open = { key: key(), kind, items: [] }
      blocks.push(open)
    }
    open.items.push(opened)
  }

  return blocks.map((block) => sealed(block, key))
}

/**
 * A block, read once it can no longer grow. The inline parse happens here and
 * nowhere else, over the whole of the text the block collected — which is what
 * lets a mark cross an authored line break.
 */
function sealed(block: OpenParagraph | OpenList | Fence | Quote, key: Keyer): Block {
  if (block.kind === 'fence' || block.kind === 'quote') return block
  if (block.kind === 'paragraph') {
    return { key: block.key, kind: 'paragraph', inline: inlineOf(block.text, EVERY_MARK, key) }
  }
  return sealedList(block, key)
}

function sealedList(list: OpenList, key: Keyer): List {
  return {
    key: list.key,
    kind: list.kind,
    items: list.items.map((item) => ({
      key: item.key,
      inline: inlineOf(item.text, EVERY_MARK, key),
      nested: item.nested.map((child) => sealedList(child, key)),
    })),
  }
}

function renderInline(nodes: readonly Inline[]): ReactNode {
  return nodes.map((node) => {
    if (node.kind === 'text') return <Fragment key={node.key}>{node.text}</Fragment>
    if (node.kind === 'code') {
      return (
        <code
          key={node.key}
          data-testid="prose-code"
          className="rounded bg-surface px-1 py-0.5 font-mono text-[0.9em]"
        >
          {node.text}
        </code>
      )
    }
    return (
      <strong key={node.key} data-testid="prose-strong" className="font-semibold">
        {renderInline(node.children)}
      </strong>
    )
  })
}

const LIST = 'space-y-1 pl-5 marker:text-muted-foreground'

/**
 * Two testids per item, by depth, so "these are the bullets" stays an exact
 * ordered claim about the top level rather than one that quietly gained a row
 * when somebody indented a line.
 */
const ITEM_TESTID = {
  bullets: { top: 'prose-bullet', nested: 'prose-nested-bullet' },
  numbers: { top: 'prose-number', nested: 'prose-nested-number' },
} as const

function renderList(list: List, depth: 'top' | 'nested'): ReactNode {
  const items = list.items.map((item) => (
    <li key={item.key} data-testid={ITEM_TESTID[list.kind][depth]}>
      {renderInline(item.inline)}
      {item.nested.map((child) => renderList(child, 'nested'))}
    </li>
  ))

  const testId =
    depth === 'nested'
      ? 'prose-nested'
      : list.kind === 'bullets'
        ? 'prose-bullets'
        : 'prose-numbers'
  const className = cn(
    list.kind === 'bullets' ? 'list-disc' : 'list-decimal',
    LIST,
    depth === 'nested' && 'mt-1',
  )

  return list.kind === 'bullets' ? (
    <ul key={list.key} data-testid={testId} className={className}>
      {items}
    </ul>
  ) : (
    <ol key={list.key} data-testid={testId} className={className}>
      {items}
    </ol>
  )
}

/**
 * The stack a document is, and the stack a quote is: one function, so what a
 * quote can hold is exactly what a document can hold and neither can quietly
 * gain a construct the other lacks.
 *
 * ("gain" rather than the flex-utility word it replaced, which the build diff
 * caught: Tailwind scans this file for candidate class names and emitted the
 * matching unused rule off a comment. A stylesheet is a function of the markup,
 * not of the prose around it.)
 */
const STACK = 'flex flex-col gap-3'

/**
 * The page's quote treatment, and the two properties the record names: a rule
 * down the left and muted ink (`r-reply-replay-convention`). Both are semantic
 * tokens, so the quote is legible in either theme with no `dark:` variant — the
 * hairline is the same border every card on this page is drawn with, and it is a
 * different value in each theme by definition.
 */
const QUOTE_LOOK = 'border-hairline border-l-2 pl-3 text-muted-foreground'

function renderBlocks(blocks: readonly Block[]): ReactNode {
  return blocks.map((block) => {
    if (block.kind === 'paragraph') {
      return (
        <p key={block.key} data-testid="prose-paragraph">
          {renderInline(block.inline)}
        </p>
      )
    }
    if (block.kind === 'fence') {
      return (
        // `overflow-x-auto` for the same reason the footprint has it: a long
        // line scrolls inside its own box rather than taking the page with
        // it, and is not rewrapped into something nobody wrote.
        <pre
          key={block.key}
          data-testid="prose-fence"
          className="overflow-x-auto whitespace-pre rounded-md bg-surface px-3 py-2 font-mono text-[0.8125rem] leading-relaxed"
        >
          <code>{block.code}</code>
        </pre>
      )
    }
    if (block.kind === 'quote') {
      return (
        <blockquote key={block.key} data-testid="prose-quote" className={cn(STACK, QUOTE_LOOK)}>
          {renderBlocks(block.blocks)}
        </blockquote>
      )
    }
    return renderList(block, 'top')
  })
}

export function Prose({
  text,
  testId,
  className,
}: {
  text: string
  testId: string
  className?: string
}) {
  const key = keyer()

  return (
    <div data-testid={testId} className={cn(STACK, 'text-sm leading-relaxed', className)}>
      {renderBlocks(blocksOf(text, key))}
    </div>
  )
}

function keyer(): Keyer {
  let sequence = 0
  return () => {
    sequence += 1
    return `n${sequence}`
  }
}
