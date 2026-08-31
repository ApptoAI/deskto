import { describe, expect, it } from "vitest"

import {
  browserArtifactBoundaryAllowed,
  browserArtifactKeysToEvict,
  browserArtifactKeyFromUrl,
  browserArtifactResponse,
  browserArtifactUrl,
  inactiveBrowserArtifactHistoryIndexes,
  type BrowserArtifactResource,
} from "./browser-artifact.js"

const pdf: BrowserArtifactResource = {
  threadId: "thread-1",
  artifactId: "artifact-1",
  name: "report.pdf",
  kind: "pdf",
  body: Uint8Array.from([0, 1, 2, 3, 4]),
}

describe("Browser artifact protocol", () => {
  it("keeps artifact identity in a bounded private URL", () => {
    const url = browserArtifactUrl(pdf)

    expect(url).toBe("deskto-artifact://preview/thread-1/artifact-1/report.pdf")
    expect(browserArtifactKeyFromUrl(url)).toBe("thread-1\nartifact-1")
    expect(
      browserArtifactKeyFromUrl("https://example.com/report.pdf")
    ).toBeUndefined()
    expect(
      browserArtifactKeyFromUrl(
        "deskto-artifact://person:secret@preview/thread-1/artifact-1/report.pdf"
      )
    ).toBeUndefined()
  })

  it("evicts only cached resources that no live history retains", () => {
    expect(
      browserArtifactKeysToEvict(
        ["old-live", "old-unused", "new-live"],
        new Set(["old-live", "new-live"]),
        2
      )
    ).toEqual(["old-unused"])
    expect(
      browserArtifactKeysToEvict(
        ["live-1", "live-2", "live-3"],
        new Set(["live-1", "live-2", "live-3"]),
        2
      )
    ).toEqual([])
  })

  it("keeps page content from crossing the private protocol boundary", () => {
    const artifactUrl = browserArtifactUrl(pdf)

    expect(
      browserArtifactBoundaryAllowed(
        artifactUrl,
        "https://example.com/escape",
        false
      )
    ).toBe(false)
    expect(
      browserArtifactBoundaryAllowed(
        artifactUrl,
        "https://example.com/toolbar",
        true
      )
    ).toBe(true)
    expect(
      browserArtifactBoundaryAllowed(
        "https://example.com/start",
        "https://example.com/next",
        false
      )
    ).toBe(true)
  })

  it("removes inactive Artifact pages from Browser history", () => {
    const first = browserArtifactUrl(pdf)
    const second = browserArtifactUrl({
      ...pdf,
      artifactId: "artifact-2",
      name: "second.pdf",
    })
    const entries = [
      { url: "https://example.com" },
      { url: first },
      { url: second },
    ]

    expect(inactiveBrowserArtifactHistoryIndexes(entries, 2)).toEqual([1])
    expect(inactiveBrowserArtifactHistoryIndexes(entries, 0)).toEqual([2, 1])
  })

  it("serves byte ranges for Chromium's PDF viewer", async () => {
    const response = browserArtifactResponse(
      new Request(browserArtifactUrl(pdf), {
        headers: { Range: "bytes=1-3" },
      }),
      pdf
    )

    expect(response.status).toBe(206)
    expect(response.headers.get("content-range")).toBe("bytes 1-3/5")
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([
      1, 2, 3,
    ])
  })

  it("runs local HTML app scripts inside the isolated sandbox", async () => {
    const html: BrowserArtifactResource = {
      threadId: "thread-1",
      artifactId: "artifact-html",
      name: "preview.html",
      kind: "html",
      body: "<h1>Preview</h1><script>alert(1)</script>",
    }
    const response = browserArtifactResponse(
      new Request(browserArtifactUrl(html)),
      html
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("content-security-policy")).toContain(
      "sandbox allow-scripts"
    )
    expect(response.headers.get("content-security-policy")).toContain(
      "script-src 'unsafe-inline' blob:"
    )
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'none'"
    )
    expect(await response.text()).toContain("<script>")
    expect(
      browserArtifactResponse(new Request(browserArtifactUrl(pdf)), html).status
    ).toBe(404)
  })
})
