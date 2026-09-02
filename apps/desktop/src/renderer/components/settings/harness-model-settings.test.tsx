// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { RuntimeClient } from "@deskto/client"
import type {
  Harness,
  RuntimeRequest,
  RuntimeTransport,
} from "@deskto/protocol"
import {
  appSettings,
  resolveSettings,
  type SettingValues,
} from "@deskto/settings"
import { afterEach, describe, expect, it, vi } from "vitest"

import { RuntimeClientProvider } from "../../runtime/runtime-client-context.js"
import { SettingsProvider } from "../../settings/settings-context.js"
import { HarnessModelSettings } from "./harness-model-settings.js"

afterEach(cleanup)

describe("HarnessModelSettings", () => {
  it("saves model visibility and removes hidden models from model menus", async () => {
    const { request } = renderSettings()

    const opus = await screen.findByRole("switch", {
      name: "Show Claude Opus for Claude Code",
    })
    fireEvent.click(opus)

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith({
        method: "settings.update",
        params: {
          entries: {
            [appSettings.modelVisibility.key]: {
              claude: ["claude-opus"],
            },
          },
        },
      })
    )
    await waitFor(() => expect(opus.getAttribute("aria-checked")).toBe("false"))

    fireEvent.click(
      screen.getByRole("button", { name: "Task title model: Same as task" })
    )
    expect(
      screen.queryByRole("menuitemradio", { name: /Claude Code · Claude Opus/ })
    ).toBeNull()
    expect(
      screen.getByRole("menuitemradio", { name: /Claude Code · Claude Haiku/ })
    ).toBeTruthy()
  })

  it("keeps one model visible for every provider", async () => {
    renderSettings()

    const codex = await screen.findByRole("switch", {
      name: "Show Codex Sol for Codex",
    })
    expect(codex.getAttribute("aria-disabled")).toBe("true")
  })
})

function renderSettings() {
  const overrides: SettingValues = {}
  const request = vi.fn((body: RuntimeRequest) => {
    if (body.method === "settings.get") {
      return Promise.resolve({
        ok: true as const,
        data: resolveSettings(overrides),
      })
    }
    if (body.method === "settings.update") {
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
  })
  render(
    <RuntimeClientProvider
      client={
        new RuntimeClient({
          // SAFETY: these tests exercise only the handled settings requests.
          request: request as RuntimeTransport["request"],
          subscribe: () => () => {},
        })
      }
    >
      <SettingsProvider>
        <HarnessModelSettings
          harnesses={{
            state: { status: "ready", data: harnesses },
            revalidate: vi.fn(),
            replace: vi.fn(),
            patch: vi.fn(),
          }}
        />
      </SettingsProvider>
    </RuntimeClientProvider>
  )
  return { request }
}

const harnesses: Harness[] = [
  harness("claude", "Claude Code", [
    ["claude-opus", "Claude Opus"],
    ["claude-haiku", "Claude Haiku"],
  ]),
  harness("codex", "Codex", [["codex-sol", "Codex Sol"]]),
  harness("pi", "Pi", [
    ["anthropic/claude-opus", "claude-opus"],
    ["xai/grok", "grok"],
  ]),
]

function harness(
  id: string,
  name: string,
  models: [id: string, name: string][]
): Harness {
  return {
    id,
    name,
    followUps: { queue: false, steer: false },
    enabled: true,
    availability: { status: "available" },
    checkedAt: "2026-09-02T12:00:00.000Z",
    models: models.map(([modelId, modelName], index) => ({
      id: modelId,
      name: modelName,
      supportedEfforts: [],
      isDefault: index === 0,
      supportedPermissionModes: ["approval-required"],
    })),
  }
}
