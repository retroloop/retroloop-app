/**
 * The route contract's ids are integers (ux-brief 03). `Number('12abc')` is NaN
 * but `parseInt('12abc')` is 12, and a URL that says `12abc` is not a request
 * for record 12 — so this is strict on purpose.
 */
export function integerId(raw: string): number | undefined {
  if (!/^\d+$/.test(raw)) return undefined
  const value = Number(raw)
  return Number.isSafeInteger(value) && value > 0 ? value : undefined
}
