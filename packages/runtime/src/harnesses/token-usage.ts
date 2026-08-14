/** Sanitize a provider-reported token count: a finite number above zero, rounded to a whole token. */
export function positiveTokens(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.round(value))
    : undefined
}
