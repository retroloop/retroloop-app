import type * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * shadcn's input, added because the settings page names things and a `Textarea`
 * with one row is a multi-line control pretending to be a single-line one — it
 * takes a newline, it grows, and it does not submit on Enter.
 *
 * The class string is `textarea.tsx`'s, minus the two rules that are only about
 * being multi-line (`field-sizing-content`, `min-h-16`) and plus the height every
 * other single-line control in this app has. Keeping them in step matters more
 * than either being clever: a name field and a note field sit on the same page.
 */
function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      data-slot="input"
      className={cn(
        'flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
