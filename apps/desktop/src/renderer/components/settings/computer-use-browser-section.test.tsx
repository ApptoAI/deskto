// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { RuntimeClient } from "@deskto/client"
import type { RuntimeTransport } from "@deskto/protocol"
import { resolveSettings, type SettingValues } from "@deskto/settings"

import { RuntimeClientProvider } from "../../runtime/runtime-client-context.js"
import { SettingsProvider } from "../../settings/settings-context.js"
import { ComputerUseSettings } from "./computer-use-settings.js"

afterEach(() => cleanup())

function renderComputerUse(stored: SettingValues = {}) {
  const overrides = { ...stored }
  const updates: SettingValues[] = []
  const request = vi.fn(
    (body: { method: string; params: { entries: SettingValues } }) => {
      if (body.method === "settings.get") {
        return Promise.resolve({
          ok: true as const,
          data: resolveSettings(overrides),
        })
      }
      if (body.method === "settings.update") {
        updates.push(body.params.entries)
        for (const [key, value] of Object.entries(body.params.entries)) {
          if (value === null) delete overrides[key]
          else overrides[key] = value
        }
        return Promise.resolve({
          ok: true as const,
          data: resolveSettings(overrides),
        })
      }
      return Promise.reject(new Error(`Unexpected request: ${body.method}`))
    }
  )
  render(
    <RuntimeClientProvider
      client={
        new RuntimeClient({
          // SAFETY: this test exercises only the two settings requests.
          request: request as RuntimeTransport["request"],
          subscribe: () => () => {},
        })
      }
    >
      <SettingsProvider>
        <ComputerUseSettings />
      </SettingsProvider>
    </RuntimeClientProvider>
  )
  return { updates }
}

describe("ComputerUseSettings", () => {
  it("shows the built-in browser section with the registry defaults", async () => {
    renderComputerUse()
    expect(await screen.findByText("Built-in browser")).toBeTruthy()
    expect(screen.getByLabelText("Page width")).toHaveProperty("value", "1280")
    expect(screen.getByLabelText("Page height")).toHaveProperty("value", "800")
    expect(screen.getByLabelText("Download folder")).toHaveProperty(
      "value",
      "downloads"
    )
    expect(screen.getByLabelText("Start page")).toHaveProperty("value", "")
  })

  it("saves a host list one rule per line and rejects a bad rule locally", async () => {
    const { updates } = renderComputerUse()
    const blocked = await screen.findByLabelText("Never open these sites")

    fireEvent.change(blocked, {
      target: { value: "ads.example.com\n\n*.tracker.net\n" },
    })
    fireEvent.blur(blocked)
    await waitFor(() => expect(updates).toHaveLength(1))
    expect(updates).toEqual([
      {
        "computerUse.browser.blocked-hosts": [
          "ads.example.com",
          "*.tracker.net",
        ],
      },
    ])

    fireEvent.change(blocked, { target: { value: "https://example.com" } })
    fireEvent.blur(blocked)
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Use a host like example.com or *.example.com"
    )
    expect(updates).toHaveLength(1)
  })

  it("clears an override back to the default from Reset", async () => {
    const { updates } = renderComputerUse({
      "computerUse.browser.home-url": "https://example.com/",
    })
    expect(await screen.findByLabelText("Start page")).toHaveProperty(
      "value",
      "https://example.com/"
    )
    fireEvent.click(screen.getByRole("button", { name: "Reset" }))
    await waitFor(() =>
      expect(screen.getByLabelText("Start page")).toHaveProperty("value", "")
    )
    expect(updates).toEqual([{ "computerUse.browser.home-url": null }])
  })
})
