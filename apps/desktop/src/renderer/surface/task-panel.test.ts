import { describe, expect, it, vi } from "vitest"

import { SurfaceApi } from "./surface-api.js"

describe("TaskPanelApi", () => {
  it("keeps file selection while moving between surfaces", () => {
    const surface = new SurfaceApi()
    const threadId = "panel-state-thread"

    surface.files.open(threadId, "report")
    surface.activities.open(threadId)
    surface.browser.open(threadId)
    expect(surface.panel.state(threadId)).toEqual({
      open: true,
      surface: "browser",
      selectedArtifactId: "report",
      folderPath: "",
    })

    surface.activities.open(threadId)
    surface.files.openPanel(threadId)
    expect(surface.panel.state(threadId)).toEqual({
      open: true,
      surface: "files",
      selectedArtifactId: "report",
      folderPath: "",
    })

    surface.activities.open(threadId)
    surface.files.retainAvailable(threadId, [])
    expect(surface.panel.state(threadId)).toEqual({
      open: true,
      surface: "activities",
      folderPath: "",
    })
  })

  it("opens the side surface and keeps its place when closed", () => {
    const surface = new SurfaceApi()
    const threadId = "panel-side-thread"

    surface.side.open(threadId)
    expect(surface.panel.state(threadId)).toEqual({
      open: true,
      surface: "side",
      folderPath: "",
    })

    surface.panel.close(threadId)
    surface.side.open(threadId)
    expect(surface.panel.state(threadId)).toEqual({
      open: true,
      surface: "side",
      folderPath: "",
    })
  })

  it("keeps the open folder while a file is read and drops it for overview", () => {
    const surface = new SurfaceApi()
    const threadId = "panel-folder-thread"

    surface.files.openFolder(threadId, "docs/adr")
    surface.files.open(threadId, "0014")
    expect(surface.panel.state(threadId)).toEqual({
      open: true,
      surface: "files",
      folderPath: "docs/adr",
      selectedArtifactId: "0014",
    })

    surface.files.openFolder(threadId, "docs/adr")
    expect(surface.panel.state(threadId)).toEqual({
      open: true,
      surface: "files",
      folderPath: "docs/adr",
    })

    surface.files.overview(threadId)
    expect(surface.panel.state(threadId)).toEqual({
      open: true,
      surface: "files",
      folderPath: "",
    })
  })

  it("keeps the folder when an open file disappears", () => {
    const surface = new SurfaceApi()
    const threadId = "panel-folder-retain-thread"

    surface.files.openFolder(threadId, "docs")
    surface.files.open(threadId, "guide")
    surface.files.retainAvailable(threadId, [])

    expect(surface.panel.state(threadId)).toEqual({
      open: true,
      surface: "files",
      folderPath: "docs",
    })
  })

  it("preserves its place when closed and notifies subscribers", () => {
    const surface = new SurfaceApi()
    const threadId = "panel-close-thread"
    const changed = vi.fn()
    const unsubscribe = surface.panel.subscribe(changed)

    surface.files.openFolder(threadId, "docs")
    surface.panel.close(threadId)
    surface.panel.close(threadId)
    unsubscribe()

    expect(surface.panel.state(threadId)).toEqual({
      open: false,
      surface: "files",
      folderPath: "docs",
    })
    expect(changed).toHaveBeenCalledTimes(2)
  })
})
