export const browserArtifactScheme = "deskto-artifact"

type BrowserArtifactIdentity = {
  threadId: string
  artifactId: string
  name: string
}

type BrowserArtifactPayload =
  | { kind: "html"; body: string }
  | { kind: "pdf"; body: Uint8Array<ArrayBuffer> }

export type BrowserArtifactResource = BrowserArtifactIdentity &
  BrowserArtifactPayload

export type BrowserArtifactInput = Omit<BrowserArtifactIdentity, "threadId"> &
  BrowserArtifactPayload

const htmlContentSecurityPolicy = [
  "sandbox",
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "object-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ")

export function browserArtifactKey(
  input: Pick<BrowserArtifactResource, "threadId" | "artifactId">
): string {
  return `${input.threadId}\n${input.artifactId}`
}

export function browserArtifactUrl(
  input: Pick<BrowserArtifactResource, "threadId" | "artifactId" | "name">
): string {
  const url = new URL(`${browserArtifactScheme}://preview`)
  url.pathname = `/${encodeURIComponent(input.threadId)}/${encodeURIComponent(input.artifactId)}/${encodeURIComponent(input.name)}`
  return url.toString()
}

export function browserArtifactKeyFromUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (
      url.protocol !== `${browserArtifactScheme}:` ||
      url.hostname !== "preview" ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return undefined
    }
    const parts = url.pathname.split("/").filter(Boolean)
    if (parts.length !== 3) return undefined
    const threadId = decodeURIComponent(parts[0]!)
    const artifactId = decodeURIComponent(parts[1]!)
    if (!threadId || !artifactId) return undefined
    return browserArtifactKey({ threadId, artifactId })
  } catch {
    return undefined
  }
}

export function isBrowserArtifactUrl(value: string): boolean {
  return browserArtifactKeyFromUrl(value) !== undefined
}

export function browserArtifactBoundaryAllowed(
  currentUrl: string,
  targetUrl: string,
  mainRequested: boolean
): boolean {
  return (
    mainRequested ||
    (!isBrowserArtifactUrl(currentUrl) && !isBrowserArtifactUrl(targetUrl))
  )
}

export function browserArtifactKeysToEvict(
  keysByAge: readonly string[],
  retainedKeys: ReadonlySet<string>,
  maximumCached: number
): string[] {
  let remaining = keysByAge.length
  const evictions: string[] = []
  for (const key of keysByAge) {
    if (remaining <= maximumCached) break
    if (retainedKeys.has(key)) continue
    evictions.push(key)
    remaining -= 1
  }
  return evictions
}

export function inactiveBrowserArtifactHistoryIndexes(
  entries: readonly { url: string }[],
  activeIndex: number
): number[] {
  const indexes: number[] = []
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (
      index !== activeIndex &&
      browserArtifactKeyFromUrl(entries[index]!.url)
    ) {
      indexes.push(index)
    }
  }
  return indexes
}

function responseHeaders(resource: BrowserArtifactResource): Headers {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(resource.name)}`,
    "Content-Type":
      resource.kind === "html" ? "text/html; charset=utf-8" : "application/pdf",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  })
  if (resource.kind === "html") {
    headers.set("Content-Security-Policy", htmlContentSecurityPolicy)
  } else {
    headers.set("Accept-Ranges", "bytes")
  }
  return headers
}

function byteRange(
  value: string | null,
  length: number
): { start: number; end: number } | "invalid" | undefined {
  if (!value) return undefined
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value.trim())
  if (!match || (!match[1] && !match[2]) || length === 0) return "invalid"
  const requestedStart = match[1] ? Number(match[1]) : undefined
  const requestedEnd = match[2] ? Number(match[2]) : undefined
  if (
    (requestedStart !== undefined && !Number.isSafeInteger(requestedStart)) ||
    (requestedEnd !== undefined && !Number.isSafeInteger(requestedEnd))
  ) {
    return "invalid"
  }
  if (requestedStart === undefined) {
    const suffixLength = requestedEnd!
    if (suffixLength <= 0) return "invalid"
    return { start: Math.max(0, length - suffixLength), end: length - 1 }
  }
  if (requestedStart >= length) return "invalid"
  const end = Math.min(requestedEnd ?? length - 1, length - 1)
  return end < requestedStart ? "invalid" : { start: requestedStart, end }
}

export function browserArtifactResponse(
  request: Request,
  resource: BrowserArtifactResource | undefined
): Response {
  if (
    !resource ||
    browserArtifactKeyFromUrl(request.url) !== browserArtifactKey(resource)
  ) {
    return new Response("Not found", { status: 404 })
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    })
  }

  const headers = responseHeaders(resource)
  if (resource.kind === "html") {
    const length = Buffer.byteLength(resource.body)
    headers.set("Content-Length", String(length))
    return new Response(request.method === "HEAD" ? null : resource.body, {
      status: 200,
      headers,
    })
  }

  const bytes = resource.body
  const range = byteRange(request.headers.get("range"), bytes.byteLength)
  if (range === "invalid") {
    headers.set("Content-Range", `bytes */${bytes.byteLength}`)
    return new Response(null, { status: 416, headers })
  }
  if (range) {
    const body = bytes.slice(range.start, range.end + 1)
    headers.set("Content-Length", String(body.byteLength))
    headers.set(
      "Content-Range",
      `bytes ${range.start}-${range.end}/${bytes.byteLength}`
    )
    return new Response(request.method === "HEAD" ? null : body, {
      status: 206,
      headers,
    })
  }
  headers.set("Content-Length", String(bytes.byteLength))
  return new Response(request.method === "HEAD" ? null : bytes, {
    status: 200,
    headers,
  })
}
