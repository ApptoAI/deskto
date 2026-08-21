import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { loadMainWindow, type LoadableMainWindow } from "./window.js"

class FakeMainWindow implements LoadableMainWindow {
  readonly loadedFiles: string[] = []
  readonly loadedUrls: string[] = []

  loadFile(filePath: string): Promise<void> {
    this.loadedFiles.push(filePath)
    return Promise.resolve()
  }

  loadURL(url: string): Promise<void> {
    this.loadedUrls.push(url)
    return Promise.resolve()
  }
}

beforeEach(() => {
  vi.stubEnv("ELECTRON_RENDERER_URL", undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("main window startup", () => {
  it("loads the packaged renderer only when startup is ready", () => {
    const window = new FakeMainWindow()

    expect(window.loadedFiles).toEqual([])
    loadMainWindow(window)

    expect(window.loadedFiles).toHaveLength(1)
    expect(window.loadedFiles[0]).toMatch(/renderer\/index\.html$/)
    expect(window.loadedUrls).toEqual([])
  })

  it("loads the development renderer only when startup is ready", () => {
    vi.stubEnv("ELECTRON_RENDERER_URL", "http://localhost:5173")
    const window = new FakeMainWindow()

    expect(window.loadedUrls).toEqual([])
    loadMainWindow(window)

    expect(window.loadedUrls).toEqual(["http://localhost:5173"])
    expect(window.loadedFiles).toEqual([])
  })
})
