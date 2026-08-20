import { afterEach, describe, expect, it, vi } from "vitest"

import type { UpdateDriver, UpdateDriverListeners } from "./update-driver.js"
import { UpdateManager } from "./update-manager.js"

class FakeUpdateDriver implements UpdateDriver {
  listeners: UpdateDriverListeners | undefined
  checks = 0
  installs = 0

  subscribe(listeners: UpdateDriverListeners): () => void {
    this.listeners = listeners
    return () => {
      this.listeners = undefined
    }
  }

  async checkForUpdates(): Promise<void> {
    this.checks += 1
  }

  quitAndInstall(): void {
    this.installs += 1
  }
}

afterEach(() => vi.useRealTimers())

describe("UpdateManager", () => {
  it("reports that development builds cannot update", async () => {
    const manager = new UpdateManager("0.1.4")

    expect(manager.getState()).toEqual({
      status: "unavailable",
      currentVersion: "0.1.4",
      message: "Updates are available in installed copies of Deskto.",
    })
    await manager.check()
    expect(manager.getState().status).toBe("unavailable")
  })

  it("maps updater events to serializable application state", async () => {
    const driver = new FakeUpdateDriver()
    const manager = new UpdateManager("0.1.4", driver)
    const states: string[] = []
    manager.subscribe((state) => states.push(state.status))

    const check = manager.check()
    driver.listeners?.available("0.1.5")
    driver.listeners?.progress(42.4)
    driver.listeners?.downloaded("0.1.5")
    await check

    expect(manager.getState()).toEqual({
      status: "ready",
      currentVersion: "0.1.4",
      availableVersion: "0.1.5",
    })
    expect(states).toEqual(["checking", "downloading", "downloading", "ready"])

    manager.install()
    expect(driver.installs).toBe(1)
  })

  it("does not start another check while an update is downloading", async () => {
    const driver = new FakeUpdateDriver()
    const manager = new UpdateManager("0.1.4", driver)

    driver.listeners?.available("0.1.5")
    await manager.check()

    expect(driver.checks).toBe(0)
  })

  it("checks after startup and on the recurring interval", async () => {
    vi.useFakeTimers()
    const driver = new FakeUpdateDriver()
    const manager = new UpdateManager("0.1.4", driver)
    driver.listeners?.notAvailable()

    manager.start()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(driver.checks).toBe(1)

    driver.listeners?.notAvailable()
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1_000)
    expect(driver.checks).toBe(2)

    manager.dispose()
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1_000)
    expect(driver.checks).toBe(2)
  })

  it("keeps install behind the downloaded state", () => {
    const driver = new FakeUpdateDriver()
    const manager = new UpdateManager("0.1.4", driver)

    expect(() => manager.install()).toThrow(
      "The update has not finished downloading yet."
    )
    expect(driver.installs).toBe(0)
  })

  it("reports a failed update download without rejecting the check", async () => {
    const driver = new FakeUpdateDriver()
    driver.checkForUpdates = () => Promise.reject(new Error("download failed"))
    const manager = new UpdateManager("0.1.4", driver)

    await expect(manager.check()).resolves.toBeUndefined()
    expect(manager.getState()).toEqual({
      status: "error",
      currentVersion: "0.1.4",
      message:
        "Deskto couldn't check for updates. Check your connection and try again.",
    })
  })
})
