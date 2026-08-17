export function normalizeBrowserUrl(value: string): string {
  const input = value.trim()
  if (!input) throw new Error("Enter a URL")
  if (input.length > 8_192) throw new Error("Browser URL is too long")
  if (/\s/.test(input)) {
    return `https://www.google.com/search?q=${encodeURIComponent(input)}`
  }
  const withProtocol = /^(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(
    input
  )
    ? `http://${input}`
    : /^[a-z][a-z0-9+.-]*:/i.test(input)
      ? input
      : `https://${input}`
  const url = new URL(withProtocol)
  if (!isBrowserWebUrl(url.toString())) {
    throw new Error("Only HTTP and HTTPS pages can open in Browser")
  }
  return url.toString()
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
