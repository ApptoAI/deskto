import type { HarnessFailure } from "./types.js"

const usageLimitPatterns = [
  /\bsession limit\b/i,
  /\busage limit\b/i,
  // A bare "rate limit" also appears in unrelated transport errors
  // ("could not parse rate limit response"), so require an exhaustion word.
  /\brate\s+limit\w*\b[\s\S]{0,40}\b(?:reached|exceeded|hit)\b/i,
  /\b(?:reached|exceeded|hit)\b[\s\S]{0,40}\brate\s+limit\b/i,
  /\bquota (?:exceeded|reached|exhausted)\b/i,
  /\byou(?:'|’)ve hit your\b.*\blimit\b/i,
]

/** Normalize terminal provider errors, including older message-only APIs. */
export function harnessFailure(
  message: string,
  resetAt?: string
): HarnessFailure {
  // Provider messages use spaces, hyphens, and underscores interchangeably.
  // Normalize only for classification; preserve the original text for users.
  const matchText = message.replace(/[_-]+/g, " ")
  const kind = usageLimitPatterns.some((pattern) => pattern.test(matchText))
    ? "usage-limit"
    : "error"
  const failure: HarnessFailure = {
    kind,
    message,
  }
  if (kind === "usage-limit" && resetAt) failure.resetAt = resetAt
  return failure
}
