import { describe, expect, it, vi } from "vitest"

import { SurfaceCommandRegistry } from "./surface-commands.js"

describe("SurfaceCommandRegistry", () => {
  it("executes registered commands", async () => {
    const commands = new SurfaceCommandRegistry()
    const run = vi.fn()
    commands.register({ id: "app.new-task", title: "New task", run })

    await commands.execute("app.new-task")

    expect(run).toHaveBeenCalledOnce()
    expect(commands.list().map((command) => command.id)).toEqual([
      "app.new-task",
    ])
  })

  it("does not execute a disabled command", async () => {
    const commands = new SurfaceCommandRegistry()
    const run = vi.fn()
    commands.register({
      id: "app.new-task",
      title: "New task",
      enabled: () => false,
      run,
    })

    await commands.execute("app.new-task")

    expect(run).not.toHaveBeenCalled()
  })

  it("removes a command through idempotent cleanup", async () => {
    const commands = new SurfaceCommandRegistry()
    const dispose = commands.register({
      id: "app.new-task",
      title: "New task",
      run: vi.fn(),
    })

    dispose()
    dispose()

    await expect(commands.execute("app.new-task")).rejects.toThrow(
      "Surface command app.new-task is not registered"
    )
  })

  it("rejects duplicate and missing command IDs", async () => {
    const commands = new SurfaceCommandRegistry()
    commands.register({
      id: "app.new-task",
      title: "New task",
      run: vi.fn(),
    })

    expect(() =>
      commands.register({
        id: "app.new-task",
        title: "Another new task",
        run: vi.fn(),
      })
    ).toThrow("Surface command app.new-task is already registered")
    await expect(commands.execute("app.missing")).rejects.toThrow(
      "Surface command app.missing is not registered"
    )
  })

  it("propagates command failures", async () => {
    const commands = new SurfaceCommandRegistry()
    const failure = new Error("Could not open")
    commands.register({
      id: "app.open-projects",
      title: "Projects",
      run: () => {
        throw failure
      },
    })

    await expect(commands.execute("app.open-projects")).rejects.toBe(failure)
  })
})
