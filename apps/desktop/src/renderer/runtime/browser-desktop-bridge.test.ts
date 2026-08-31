import { afterEach, describe, expect, it, vi } from "vitest"

import { createBrowserDesktopBridge } from "./browser-desktop-bridge.js"

class FakeEventSource {
  static readonly instances: FakeEventSource[] = []

  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }
}

afterEach(() => {
  FakeEventSource.instances.length = 0
  vi.unstubAllGlobals()
})

describe("browser desktop bridge", () => {
  it("keeps one EventSource while the browser owns reconnection", () => {
    vi.stubGlobal("EventSource", FakeEventSource)
    const bridge = createBrowserDesktopBridge()

    bridge.runtime.subscribe(() => {})
    FakeEventSource.instances[0]?.onerror?.(new Event("error"))
    bridge.runtime.subscribe(() => {})

    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeEventSource.instances[0]?.url).toBe("/bridge/events")
  })

  it("does not advertise native window controls in a browser tab", () => {
    const bridge = createBrowserDesktopBridge()

    expect(bridge.windowControls).toBeUndefined()
  })
})
