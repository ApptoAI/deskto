/** Sanitize a provider-reported token count: a finite number above zero, rounded to a whole token. */
export function positiveTokens(
  value: number | null | undefined
): number | undefined {
  return value !== null &&
    value !== undefined &&
    Number.isFinite(value) &&
    value > 0
    ? Math.max(1, Math.round(value))
    : undefined
}
