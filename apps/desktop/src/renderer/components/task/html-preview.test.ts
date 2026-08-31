// @vitest-environment jsdom

import { describe, expect, it } from "vitest"

import { sanitizeHtmlPreview } from "./html-preview.js"

describe("HTML file preview", () => {
  it("sanitizes a page synchronously without a React query lifecycle", () => {
    const sanitized = sanitizeHtmlPreview(`<!doctype html>
      <html><body>
        <h1>Report</h1>
        <script>document.body.dataset.executed = "true"</script>
        <form><input value="private"></form>
      </body></html>`)

    expect(sanitized).toContain("<h1>Report</h1>")
    expect(sanitized).not.toContain("<script")
    expect(sanitized).not.toContain("<form")
    expect(sanitized).not.toContain("<input")
  })
})
