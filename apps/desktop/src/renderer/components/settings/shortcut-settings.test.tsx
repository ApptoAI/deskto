// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { RuntimeClient } from "@deskto/client"
import type { RuntimeTransport } from "@deskto/protocol"
import { appSettings, resolveSettings } from "@deskto/settings"
import { afterEach, describe, expect, it, vi } from "vitest"

import { RuntimeClientProvider } from "../../runtime/runtime-client-context.js"
import { SettingsProvider } from "../../settings/settings-context.js"
import { ShortcutSettings } from "./shortcut-settings.js"

afterEach(cleanup)

const newTask = appSettings.newTaskKeybinding
const toggleSidebar = appSettings.toggleSidebarKeybinding

describe("ShortcutSettings", () => {
  it("saves a recorded combination", async () => {
    const { request } = renderShortcuts()
    const recorder = await findRecorder(newTask.label)

    fireEvent.click(recorder)
    expect(recorder.textContent).toBe("Press keys…")
    fireEvent.keyDown(recorder, { key: "k", ctrlKey: true })

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith({
        method: "settings.update",
        params: { entries: { [newTask.key]: "mod+k" } },
      })
    )
  })

  it("refuses a combination another shortcut holds and names it", async () => {
    const { request } = renderShortcuts()
    const recorder = await findRecorder(newTask.label)

    fireEvent.click(recorder)
    fireEvent.keyDown(recorder, { key: "b", ctrlKey: true })

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain(toggleSidebar.label)
    expect(alert.textContent).toContain("reset that shortcut")
    expect(request).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: "settings.update" })
    )
  })

  it("explains a key it cannot record and keeps listening", async () => {
    renderShortcuts()
    const recorder = await findRecorder(newTask.label)

    fireEvent.click(recorder)
    fireEvent.keyDown(recorder, { key: "k" })

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("Hold one and press again")
    expect(recorder.textContent).toBe("Press keys…")
  })

  it("explains a layout-dependent key even with a modifier held", async () => {
    renderShortcuts()
    const recorder = await findRecorder(newTask.label)

    fireEvent.click(recorder)
    fireEvent.keyDown(recorder, { key: "Dead", ctrlKey: true })

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("changes with the keyboard layout")
    expect(recorder.textContent).toBe("Press keys…")
  })

  it("lets Tab and Escape leave the recorder without saving", async () => {
    const { request } = renderShortcuts()
    const recorder = await findRecorder(newTask.label)

    fireEvent.click(recorder)
    const tab = fireEvent.keyDown(recorder, { key: "Tab" })
    expect(tab).toBe(true)
    expect(recorder.textContent).not.toBe("Press keys…")

    fireEvent.click(recorder)
    fireEvent.keyDown(recorder, { key: "Escape" })
    expect(recorder.textContent).not.toBe("Press keys…")
    expect(request).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: "settings.update" })
    )
  })
})

async function findRecorder(label: string): Promise<HTMLElement> {
  return screen.findByRole("button", { name: `Change shortcut for ${label}` })
}

function renderShortcuts() {
  const request = vi.fn((body: { method: string }) => {
    if (body.method === "settings.get" || body.method === "settings.update") {
      return Promise.resolve({ ok: true as const, data: resolveSettings({}) })
    }
    return Promise.reject(new Error(`Unexpected request: ${body.method}`))
  })
  render(
    <RuntimeClientProvider
      client={
        new RuntimeClient({
          // SAFETY: these tests exercise only the handled requests.
          request: request as RuntimeTransport["request"],
          subscribe: () => () => {},
        })
      }
    >
      <SettingsProvider>
        <ShortcutSettings />
      </SettingsProvider>
    </RuntimeClientProvider>
  )
  return { request }
}
