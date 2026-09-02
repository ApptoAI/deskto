import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { resolveSettings } from "@deskto/settings"
import { afterEach, describe, expect, it } from "vitest"

import {
  browserDownloadDirectory,
  browserDownloadFileName,
  browserSettingsFrom,
  defaultBrowserSettings,
  prepareBrowserDownloadDirectory,
} from "./browser-settings.js"

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("browser settings", () => {
  it("reads defaults when nothing is overridden", () => {
    expect(browserSettingsFrom(resolveSettings({}))).toEqual(
      defaultBrowserSettings
    )
    expect(defaultBrowserSettings.viewport).toEqual({
      width: 1280,
      height: 800,
    })
    expect(defaultBrowserSettings.downloadFolder).toBe("downloads")
    expect(defaultBrowserSettings.homeUrl).toBe("")
  })

  it("reads overrides from the computerUse namespace", () => {
    const settings = browserSettingsFrom(
      resolveSettings({
        "computerUse.browser.user-agent": "Deskto/1.0",
        "computerUse.browser.viewport": { width: 1024, height: 768 },
        "computerUse.browser.allowed-hosts": ["*.example.com"],
        "computerUse.browser.blocked-hosts": ["ads.example.com"],
        "computerUse.browser.clear-session-between-tasks": true,
        "computerUse.browser.download-folder": "",
        "computerUse.browser.home-url": "https://example.com/start",
      })
    )
    expect(settings).toEqual({
      userAgent: "Deskto/1.0",
      viewport: { width: 1024, height: 768 },
      hostRules: { allow: ["*.example.com"], deny: ["ads.example.com"] },
      clearSessionBetweenTasks: true,
      downloadFolder: "",
      homeUrl: "https://example.com/start",
    })
  })
})

describe("browser downloads", () => {
  const project = path.resolve("/projects/demo")

  it("resolve inside the project only", () => {
    expect(browserDownloadDirectory(project, "downloads")).toBe(
      path.join(project, "downloads")
    )
    expect(browserDownloadDirectory(project, "files/web")).toBe(
      path.join(project, "files", "web")
    )
    expect(browserDownloadDirectory(project, "")).toBeUndefined()
    expect(browserDownloadDirectory(undefined, "downloads")).toBeUndefined()
    expect(browserDownloadDirectory(project, "..")).toBeUndefined()
    expect(browserDownloadDirectory(project, "../other")).toBeUndefined()
  })

  it("creates a physical folder inside the project", () => {
    const project = mkdtempSync(path.join(os.tmpdir(), "deskto-project-"))
    temporaryDirectories.push(project)
    const directory = prepareBrowserDownloadDirectory(project, "files/web")
    expect(directory).toBe(path.join(project, "files", "web"))
    expect(existsSync(directory ?? "")).toBe(true)
  })

  it("rejects a download folder symlinked outside the project", () => {
    const project = mkdtempSync(path.join(os.tmpdir(), "deskto-project-"))
    const outside = mkdtempSync(path.join(os.tmpdir(), "deskto-outside-"))
    temporaryDirectories.push(project, outside)
    symlinkSync(outside, path.join(project, "downloads"), "dir")
    expect(
      prepareBrowserDownloadDirectory(project, "downloads/private")
    ).toBeUndefined()
    expect(existsSync(path.join(outside, "private"))).toBe(false)
  })

  it("keep a page-suggested file name to one safe segment", () => {
    expect(browserDownloadFileName("report.pdf")).toBe("report.pdf")
    expect(browserDownloadFileName("../../etc/passwd")).toBe("passwd")
    expect(browserDownloadFileName("..\\..\\win.ini")).toBe("win.ini")
    expect(browserDownloadFileName(".hidden")).toBe("hidden")
    expect(browserDownloadFileName("")).toBe("download")
    expect(browserDownloadFileName("a<b>:c.txt")).toBe("a_b__c.txt")
  })
})
