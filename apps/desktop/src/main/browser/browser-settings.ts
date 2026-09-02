import path from "node:path"

import {
  computerUseSettings,
  settingValue,
  type BrowserViewport,
  type SettingsSnapshot,
} from "@deskto/settings"

/** The settings the task browser reads, resolved from a settings snapshot. */
export type BrowserSettings = {
  /** Empty keeps Chromium's own user agent. */
  userAgent: string
  viewport: BrowserViewport
  hostRules: { allow: readonly string[]; deny: readonly string[] }
  clearSessionBetweenTasks: boolean
  /** Project-relative; empty keeps downloads blocked. */
  downloadFolder: string
  /** Empty starts a task's browser blank. */
  homeUrl: string
}

export function browserSettingsFrom(
  snapshot: SettingsSnapshot | null
): BrowserSettings {
  return {
    userAgent: settingValue(snapshot, computerUseSettings.browserUserAgent),
    viewport: settingValue(snapshot, computerUseSettings.browserViewport),
    hostRules: {
      allow: settingValue(snapshot, computerUseSettings.browserAllowedHosts),
      deny: settingValue(snapshot, computerUseSettings.browserBlockedHosts),
    },
    clearSessionBetweenTasks: settingValue(
      snapshot,
      computerUseSettings.browserClearSessionBetweenTasks
    ),
    downloadFolder: settingValue(
      snapshot,
      computerUseSettings.browserDownloadFolder
    ),
    homeUrl: settingValue(snapshot, computerUseSettings.browserHomeUrl),
  }
}

export const defaultBrowserSettings: BrowserSettings = browserSettingsFrom(null)

/**
 * Where a download lands, or undefined when downloads stay blocked or the
 * folder would leave the project. The Runtime validated the folder setting;
 * this guards the join against a project path that changed underneath.
 */
export function browserDownloadDirectory(
  projectPath: string | undefined,
  downloadFolder: string
): string | undefined {
  if (!projectPath || !downloadFolder) return undefined
  const root = path.resolve(projectPath)
  const directory = path.resolve(root, ...downloadFolder.split(/[/\\]/))
  const fromRoot = path.relative(root, directory)
  if (
    fromRoot === "" ||
    fromRoot === ".." ||
    fromRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(fromRoot)
  ) {
    return undefined
  }
  return directory
}

/** A file name a page suggested, reduced to something safe to write. */
export function browserDownloadFileName(suggested: string): string {
  const base = Array.from(path.basename(suggested.replace(/[\\/]/g, "/")))
    .map((character) => {
      const code = character.charCodeAt(0)
      return code <= 31 || code === 127 || /[<>:"|?*]/.test(character)
        ? "_"
        : character
    })
    .join("")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 200)
  return base || "download"
}
