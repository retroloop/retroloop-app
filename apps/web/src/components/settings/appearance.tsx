import { type Theme, useTheme } from '@/components/chrome/theme-provider'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * Settings › Appearance › Dark Mode (`r-theme-under-settings`): the dark-mode
 * setting lives here, and it defaults to System mode.
 *
 * **The default was already System and is not invented here.** `ThemeProvider`
 * already read `system` as its starting value — the OS decides, and
 * it keeps deciding, so a machine that flips at sunset flips this page. What
 * changed is *where the control lives*: a theme is a set-and-forget
 * preference, not a per-page affordance, so it belongs on the one page that is
 * about the product rather than in the chrome of every page in it.
 *
 * **The header toggle is gone, and nothing here had to change when it went.**
 * It went when the top menu collapsed into one dropdown
 * (`chrome/app-menu.tsx`), which is explicit that the theme moves *under
 * Settings* rather than into the menu. Both controls only ever read and wrote
 * the same `ThemeProvider` state, so the removal took a duplicate away and left
 * the setting here: this is now the only place in the product
 * that changes the theme, which is also why every scenario that needs a theme
 * comes through here.
 *
 * **A `Select` rather than three radio buttons or a switch.** A switch cannot
 * express three states, and the third state is the default;
 * three radios would spend three rows of a section that has one
 * setting in it. The trigger says which of the three is chosen, which is the
 * whole of what this control has to answer.
 */
export function Appearance() {
  const { theme, setTheme } = useTheme()

  return (
    <section className="flex flex-col gap-2" data-testid="settings-appearance">
      <div className="flex flex-wrap items-center gap-3">
        <Label htmlFor="dark-mode">Dark Mode</Label>
        <Select value={theme} onValueChange={(next) => setTheme(next as Theme)}>
          <SelectTrigger id="dark-mode" size="sm" className="w-36" data-testid="settings-theme">
            <SelectValue aria-label="Dark Mode" />
          </SelectTrigger>
          <SelectContent>
            {OPTIONS.map(({ value, label }) => (
              <SelectItem key={value} value={value} data-testid={`settings-theme-${value}`}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/**
       * **What "System" actually means**, because it is the default and it is
       * the one option whose behaviour a reader cannot infer from its name: it
       * is not a third colour scheme, it is a deferral, and it keeps deferring.
       * The same rule the AI-config-write switch's own sentence follows — the
       * state a control is in should be readable in words and not only in the
       * control (`tag.tsx`).
       */}
      <p className="text-muted-foreground text-sm" data-testid="settings-theme-note">
        System follows this device, and keeps following it. Light and Dark are yours, and survive a
        reload.
      </p>
    </section>
  )
}

/**
 * The three, in the order the header's own menu listed them until it was retired
 * — light, dark, then the deferral — so the reader who learned the old control
 * meets the same order in the one that replaced it.
 *
 * **Names only, where the header menu carried an icon each.** The icon earned
 * its place up there because the trigger was a single glyph and the menu had to
 * teach what that glyph meant; here the control is a labelled row in a settings
 * section, and a sun beside the word "Light" is decoration this page's rule does
 * not pay for. It also keeps the trigger's text exactly the chosen option's
 * name, which is what makes that name assertable.
 */
const OPTIONS: readonly { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
]
