import type { HarnessFailure } from "./types.js"

const usageLimitPatterns = [
  /\bsession limit\b/i,
  /\busage limit\b/i,
  // A bare "rate limit" also appears in unrelated transport errors
  // ("could not parse rate limit response"), so require an exhaustion word.
  /\brate limit\w*\b.{0,40}\b(?:reached|exceeded|hit)\b/i,
  /\b(?:reached|exceeded|hit)\b.{0,40}\brate limit\b/i,
  /\bquota (?:exceeded|reached|exhausted)\b/i,
  /\byou(?:'|’)ve hit your\b.*\blimit\b/i,
]

/** Normalize terminal provider errors, including older message-only APIs. */
export function harnessFailure(
  message: string,
  resetAt?: string
): HarnessFailure {
  const kind = usageLimitPatterns.some((pattern) => pattern.test(message))
    ? "usage-limit"
    : "error"
  return {
    kind,
    message,
    ...(kind === "usage-limit" && resetAt ? { resetAt } : {}),
  }
}
