// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { BrowserProfile } from "@deskto/protocol"

import {
  BrowserProfilesSection,
  formatBytes,
} from "./computer-use-profiles-section.js"
import { computerUseSections } from "./computer-use-sections.js"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function stubBridge(profiles: BrowserProfile[]) {
  const clearProfile = vi.fn((workspaceId: string) =>
    Promise.resolve({ workspaceId, clearedBytes: 1536 })
  )
  const openProfileFolder = vi.fn(() => Promise.resolve())
  vi.stubGlobal("deskto", {
    browser: {
      profiles: () => Promise.resolve([...profiles]),
      clearProfile,
      openProfileFolder,
    },
  })
  return { clearProfile, openProfileFolder }
}

const personal: BrowserProfile = {
  workspaceId: "ws-personal",
  workspaceName: "Personal",
  sizeBytes: 1536,
  lastUsedAt: "2026-08-30T12:00:00.000Z",
}
const fresh: BrowserProfile = {
  workspaceId: "ws-fresh",
  workspaceName: "Fresh",
  sizeBytes: 0,
  lastUsedAt: null,
}

describe("Browser profiles section", () => {
  it("sits on the Computer use page after the browser block", () => {
    expect(computerUseSections.map((section) => section.id)).toEqual([
      "browser",
      "profiles",
      "screen-control",
      "cookie-import",
    ])
  })

  it("formats profile sizes in the nearest unit", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(1536)).toBe("1.5 KB")
    expect(formatBytes(120 * 1024 * 1024)).toBe("120 MB")
  })

  it("lists every workspace and disables actions on an empty profile", async () => {
    stubBridge([personal, fresh])
    render(<BrowserProfilesSection />)

    expect(await screen.findByText("Personal")).toBeTruthy()
    expect(screen.getByText("No browser data yet")).toBeTruthy()
    const [, freshClear] = screen.getAllByRole("button", {
      name: "Clear browser data",
    })
    expect(freshClear).toHaveProperty("disabled", true)
  })

  it("clears only after a second click and keeps on the way out", async () => {
    const { clearProfile } = stubBridge([personal])
    render(<BrowserProfilesSection />)

    fireEvent.click(
      await screen.findByRole("button", { name: "Clear browser data" })
    )
    fireEvent.click(screen.getByRole("button", { name: "Keep" }))
    expect(clearProfile).not.toHaveBeenCalled()
    expect(
      screen.getByRole("button", { name: "Clear browser data" })
    ).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Clear browser data" }))
    fireEvent.click(
      screen.getByRole("button", { name: "Signs you out of every site. Clear?" })
    )
    await waitFor(() => expect(clearProfile).toHaveBeenCalledWith("ws-personal"))
    expect(await screen.findByRole("status")).toHaveProperty(
      "textContent",
      "Cleared 1.5 KB. Sites will ask you to sign in again."
    )
  })

  it("shows a failed clear on the row", async () => {
    const { clearProfile } = stubBridge([personal])
    clearProfile.mockRejectedValueOnce(new Error("Close the browser first."))
    render(<BrowserProfilesSection />)

    fireEvent.click(
      await screen.findByRole("button", { name: "Clear browser data" })
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Signs you out of every site. Clear?" })
    )
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Close the browser first."
    )
  })
})
