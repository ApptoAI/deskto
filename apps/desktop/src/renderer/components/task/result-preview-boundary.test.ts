// @vitest-environment jsdom

import { act, createElement } from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  ResultPreviewBoundary,
  resultPreviewErrorMessage,
} from "./result-preview-boundary.js"

afterEach(cleanup)

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

    try {
      render(
        createElement(
          "section",
          { "data-testid": "task-shell" },
          createElement(ResultPreviewBoundary, null, createElement(Preview))
        )
      )

      expect(screen.getByTestId("task-shell")).toBeDefined()
      expect(
        screen.getByText(/Deskto could not show this preview/)
      ).toBeDefined()

      broken = false
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "Try preview again" })
        )
      })
      expect(screen.getByText("Preview ready")).toBeDefined()
    } finally {
      consoleError.mockRestore()
    }
  })
})
