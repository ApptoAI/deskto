// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { RuntimeClient } from "@deskto/client"
import type { RuntimeTransport } from "@deskto/protocol"
import { appSettings, resolveSettings } from "@deskto/settings"
import { afterEach, describe, expect, it, vi } from "vitest"

import { RuntimeClientProvider } from "../runtime/runtime-client-context.js"
import { SettingsProvider } from "./settings-context.js"
import { useKeybinding } from "./use-keybinding.js"

afterEach(cleanup)

function Bound({ onTrigger }: { onTrigger: () => void }) {
  useKeybinding(appSettings.newTaskKeybinding, onTrigger)
  return (
    <>
      <input aria-label="Plain field" />
      <div role="dialog">
        <input aria-label="Dialog field" />
      </div>
    </>
  )
}

describe("useKeybinding", () => {
  it("fires from the page but not from inside a dialog", () => {
    const onTrigger = vi.fn()
    renderBound(onTrigger)

    fireEvent.keyDown(screen.getByLabelText("Dialog field"), {
      key: "n",
      ctrlKey: true,
    })
    expect(onTrigger).not.toHaveBeenCalled()

    fireEvent.keyDown(screen.getByLabelText("Plain field"), {
      key: "n",
      ctrlKey: true,
    })
    expect(onTrigger).toHaveBeenCalledOnce()
  })
})

function renderBound(onTrigger: () => void) {
  const request = vi.fn((body: { method: string }) => {
    if (body.method === "settings.get") {
      return Promise.resolve({ ok: true as const, data: resolveSettings({}) })
    }
    return Promise.reject(new Error(`Unexpected request: ${body.method}`))
  })
  render(
    <RuntimeClientProvider
      client={
        new RuntimeClient({
          // SAFETY: this test exercises only the handled request.
          request: request as RuntimeTransport["request"],
          subscribe: () => () => {},
        })
      }
    >
      <SettingsProvider>
        <Bound onTrigger={onTrigger} />
      </SettingsProvider>
    </RuntimeClientProvider>
  )
}
