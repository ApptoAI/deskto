import { createElement } from "react"
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer"
import { describe, expect, it, vi } from "vitest"

import {
  ResultPreviewBoundary,
  resultPreviewErrorMessage,
} from "./result-preview-boundary.js"

describe("ResultPreviewBoundary", () => {
  it("keeps a useful Error message", () => {
    expect(resultPreviewErrorMessage(new Error("PDF renderer failed"))).toBe(
      "PDF renderer failed"
    )
  })

  it("normalizes an empty Error message", () => {
    expect(resultPreviewErrorMessage(new Error(""))).toBe(
      "The preview renderer stopped unexpectedly."
    )
  })

  it("enters the fallback state even when the Error message is empty", () => {
    expect(
      ResultPreviewBoundary.getDerivedStateFromError(new Error(""))
    ).toEqual({
      failed: true,
      message: "The preview renderer stopped unexpectedly.",
    })
  })

  it("keeps the task shell mounted and retries a broken preview", async () => {
    let broken = true
    function Preview() {
      if (broken) throw new Error("PDF renderer failed")
      return createElement("p", null, "Preview ready")
    }

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    let renderer: ReactTestRenderer | undefined

    try {
      await act(async () => {
        renderer = TestRenderer.create(
          createElement(
            "section",
            { "data-testid": "task-shell" },
            createElement(ResultPreviewBoundary, null, createElement(Preview))
          )
        )
      })

      expect(
        renderer?.root.findByProps({ "data-testid": "task-shell" })
      ).toBeDefined()
      expect(JSON.stringify(renderer?.toJSON())).toContain(
        "Deskto could not show this preview"
      )

      broken = false
      const retry = renderer?.root.findByType("button")
      expect(retry).toBeDefined()
      await act(async () => {
        retry?.props.onClick()
      })
      expect(JSON.stringify(renderer?.toJSON())).toContain("Preview ready")
    } finally {
      if (renderer) await act(async () => renderer?.unmount())
      consoleError.mockRestore()
    }
  })
})
