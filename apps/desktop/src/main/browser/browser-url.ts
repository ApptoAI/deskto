import { browserHostAllowed } from "@deskto/settings"

export const maximumBrowserUrlLength = 8_192

export function normalizeBrowserUrl(value: string): string {
  const input = value.trim()
  if (!input) throw new Error("Enter a URL")
  if (input.length > maximumBrowserUrlLength)
    throw new Error("Browser URL is too long")
  if (/\s/.test(input)) {
    return `https://www.google.com/search?q=${encodeURIComponent(input)}`
  }
  const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(input)
  const hostWithPort = /^[a-z0-9.-]+:\d+(?:[/?#]|$)/i.test(input)
  const withProtocol = localHost
    ? `http://${input}`
    : !hostWithPort && /^[a-z][a-z0-9+.-]*:/i.test(input)
      ? input
      : `https://${input}`
  const url = new URL(withProtocol)
  if (!isBrowserWebUrl(url.toString())) {
    throw new Error("Only HTTP and HTTPS pages can open in Browser")
  }
  return url.toString()
}

/**
 * Whether the person's host rules let this URL open. Only web pages carry a
 * host; the blank page and Artifact previews are never subject to the list.
 */
export function isBrowserHostPermitted(
  value: string,
  rules: { allow: readonly string[]; deny: readonly string[] }
): boolean {
  if (value === "about:blank") return true
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return true
    return browserHostAllowed(url.hostname, rules)
  } catch {
    return false
  }
}

export function isBrowserWebUrl(value: string): boolean {
  if (value === "about:blank") return true
  try {
    const protocol = new URL(value).protocol
    return protocol === "http:" || protocol === "https:"
  } catch {
    return false
  }
}
