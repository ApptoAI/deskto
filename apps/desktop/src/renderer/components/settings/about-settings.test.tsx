// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { UpdateState } from "../../../shared/desktop-api.js"
import { UpdatesProvider } from "../../updates/updates-context.js"
import { AboutSettings } from "./about-settings.js"

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, "deskto")
})

function renderAbout(
  state: UpdateState,
  options: {
    readState?: () => Promise<UpdateState>
    install?: () => Promise<void>
  } = {}
) {
  const check = vi.fn(() => Promise.resolve())
  const install = vi.fn(options.install ?? (() => Promise.resolve()))
  const listeners = new Set<(next: UpdateState) => void>()
  Object.defineProperty(window, "deskto", {
    configurable: true,
    value: {
      updates: {
        state: options.readState ?? (() => Promise.resolve(state)),
        check,
        install,
        subscribe: (listener: (next: UpdateState) => void) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      },
    },
  })
  render(
    <UpdatesProvider>
      <AboutSettings />
    </UpdatesProvider>
  )
  return {
    check,
    install,
    publish: (next: UpdateState) => {
      for (const listener of listeners) listener(next)
    },
    listenerCount: () => listeners.size,
  }
}

describe("AboutSettings", () => {
  it("shows the installed version and checks on request", async () => {
    const { check } = renderAbout({
      status: "up-to-date",
      currentVersion: "0.1.42",
    })

    expect(await screen.findByText("Version 0.1.42")).toBeTruthy()
    expect(screen.getByText("Deskto is up to date.")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }))
    expect(check).toHaveBeenCalledOnce()
  })

  it("offers a restart only after the update is ready", async () => {
    const { install } = renderAbout({
      status: "ready",
      currentVersion: "0.1.42",
      availableVersion: "0.1.43",
    })

    expect(
      await screen.findByText("Version 0.1.43 is ready to install.")
    ).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Restart to update" }))
    expect(install).toHaveBeenCalledOnce()
  })

  it("explains how to recover when update status cannot load", async () => {
    renderAbout(
      { status: "idle", currentVersion: "0.1.42" },
      { readState: () => Promise.reject(new Error("IPC unavailable")) }
    )

    expect(
      await screen.findByText(
        "Deskto couldn't read update status. Quit Deskto and open it again."
      )
    ).toBeTruthy()
    expect(screen.getByText("Version unavailable")).toBeTruthy()
  })

  it("shows a recovery step when restart fails", async () => {
    renderAbout(
      {
        status: "ready",
        currentVersion: "0.1.42",
        availableVersion: "0.1.43",
      },
      { install: () => Promise.reject(new Error("IPC unavailable")) }
    )

    fireEvent.click(
      await screen.findByRole("button", { name: "Restart to update" })
    )
    expect(
      await screen.findByText(
        "Deskto couldn't restart for the update. Quit Deskto and open it again to install it."
      )
    ).toBeTruthy()
  })

  it("recovers when an update event arrives after the initial read fails", async () => {
    const { publish, listenerCount } = renderAbout(
      { status: "idle", currentVersion: "0.1.42" },
      { readState: () => Promise.reject(new Error("IPC unavailable")) }
    )

    expect(
      await screen.findByText(
        "Deskto couldn't read update status. Quit Deskto and open it again."
      )
    ).toBeTruthy()
    expect(listenerCount()).toBe(1)

    await act(async () => {
      publish({ status: "up-to-date", currentVersion: "0.1.42" })
    })

    expect(screen.getByText("Deskto is up to date.")).toBeTruthy()
    expect(screen.queryByText("Version unavailable")).toBeNull()
  })
})
