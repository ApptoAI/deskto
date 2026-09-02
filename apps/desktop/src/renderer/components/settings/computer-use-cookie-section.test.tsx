// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CookieImportSection } from "./computer-use-cookie-section.js"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("Cookie import section", () => {
  it("sends the chosen workspace with the import request", async () => {
    const run = vi.fn(() =>
      Promise.resolve({ imported: 2, skipped: 0 })
    )
    vi.stubGlobal("deskto", {
      browser: {
        profiles: () =>
          Promise.resolve([
            {
              workspaceId: "ws-personal",
              workspaceName: "Personal",
              sizeBytes: 0,
              lastUsedAt: null,
            },
            {
              workspaceId: "ws-sales",
              workspaceName: "Sales",
              sizeBytes: 0,
              lastUsedAt: null,
            },
          ]),
      },
      cookieImport: {
        discover: () =>
          Promise.resolve([
            {
              id: "chrome:Default",
              browserId: "chrome",
              browserLabel: "Chrome",
              profileDirectory: "Default",
              profileName: "Default",
            },
          ]),
        run,
      },
    })

    render(<CookieImportSection />)
    const select = await screen.findByLabelText("Workspace")
    fireEvent.change(select, { target: { value: "ws-sales" } })
    fireEvent.change(screen.getByLabelText("Websites"), {
      target: { value: "example.com" },
    })
    const importButton = screen.getByRole<HTMLButtonElement>("button", {
      name: "Import cookies",
    })
    await waitFor(() => expect(importButton.disabled).toBe(false))
    fireEvent.click(importButton)

    await waitFor(() =>
      expect(run).toHaveBeenCalledWith({
        profileId: "chrome:Default",
        workspaceId: "ws-sales",
        hosts: ["example.com"],
      })
    )
    expect((await screen.findByRole("status")).textContent).toBe(
      "Imported 2 cookies."
    )
  })
})
