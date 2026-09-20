import { Switch as SwitchPrimitive } from 'radix-ui'
import type * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * shadcn's switch — the one control on the settings page: a toggle the human
 * can enable to give the AI the ability to update the configuration.
 *
 * Radix rather than a `<button aria-pressed>`, which is what the filter chips
 * are: a chip is a filter the reader turns on and off and `pressed` says so; a
 * switch is a **setting**, and `role="switch"` with `aria-checked` is what says
 * *that*. The difference is not decoration — a screen reader announces "switch,
 * on" for one and "button, pressed" for the other, and this control is the only
 * thing standing between the AI and the configuration.
 *
 * The state is carried by the thumb's position **and** by the track's colour,
 * and the label beside it says which way is which — the same rule every tag in
 * this app obeys (`tag.tsx`): state is never colour alone.
 */
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent shadow-xs outline-none transition-all focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input dark:data-[state=unchecked]:bg-input/80',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 rounded-full bg-background ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0.5 dark:data-[state=checked]:bg-primary-foreground dark:data-[state=unchecked]:bg-foreground"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
