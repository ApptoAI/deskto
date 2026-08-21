import { describe, expect, it, vi } from "vitest"

import { SurfaceNavigationApi } from "./navigation.js"

describe("SurfaceNavigationApi", () => {
  it("routes navigation through the active host", () => {
    const navigation = new SurfaceNavigationApi()
    const host = {
      newTask: vi.fn(),
      openTask: vi.fn(),
      openProjects: vi.fn(),
      openSkills: vi.fn(),
      openSettings: vi.fn(),
      nextWorkspace: vi.fn(),
      previousWorkspace: vi.fn(),
    }
    navigation.register(host)

    navigation.newTask()
    navigation.openTask("thread-1")
    navigation.openProjects()
    navigation.openSkills()
    navigation.openSettings()
    navigation.nextWorkspace()
    navigation.previousWorkspace()

    expect(host.newTask).toHaveBeenCalledOnce()
    expect(host.openTask).toHaveBeenCalledWith("thread-1")
    expect(host.openProjects).toHaveBeenCalledOnce()
    expect(host.openSkills).toHaveBeenCalledOnce()
    expect(host.openSettings).toHaveBeenCalledOnce()
    expect(host.nextWorkspace).toHaveBeenCalledOnce()
    expect(host.previousWorkspace).toHaveBeenCalledOnce()
  })

  it("releases its host idempotently", () => {
    const navigation = new SurfaceNavigationApi()
    const host = {
      newTask: vi.fn(),
      openTask: vi.fn(),
      openProjects: vi.fn(),
      openSkills: vi.fn(),
      openSettings: vi.fn(),
      nextWorkspace: vi.fn(),
      previousWorkspace: vi.fn(),
    }
    const dispose = navigation.register(host)
    dispose()
    dispose()

    expect(() => navigation.newTask()).toThrow(
      "Surface navigation is not registered"
    )
  })
})
