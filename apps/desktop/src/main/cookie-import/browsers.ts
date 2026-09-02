import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { z } from "zod"

import type { BrowserId } from "../../shared/desktop-api.js"

export type SupportedPlatform = "darwin" | "linux" | "win32"

/**
 * A Chromium family browser Deskto can read cookies from. The per-platform
 * paths are relative to the platform's application-data root and `keychain`
 * names the macOS Safe Storage account and the app used to look it up. These
 * are the browsers' own values, fixed by their installers.
 */
type BrowserDefinition = {
  id: BrowserId
  label: string
  /** Path under `~/Library/Application Support` on macOS. */
  darwin: string
  /** Path under `~/.config` on Linux. */
  linux: string
  /** Path under `%LOCALAPPDATA%` on Windows, including `User Data`. */
  win32: string
  /** macOS keychain Safe Storage service name, e.g. "Chrome Safe Storage". */
  safeStorageService: string
}

export const browserDefinitions: readonly BrowserDefinition[] = [
  {
    id: "chrome",
    label: "Google Chrome",
    darwin: "Google/Chrome",
    linux: "google-chrome",
    win32: "Google/Chrome/User Data",
    safeStorageService: "Chrome Safe Storage",
  },
  {
    id: "chromium",
    label: "Chromium",
    darwin: "Chromium",
    linux: "chromium",
    win32: "Chromium/User Data",
    safeStorageService: "Chromium Safe Storage",
  },
  {
    id: "brave",
    label: "Brave",
    darwin: "BraveSoftware/Brave-Browser",
    linux: "BraveSoftware/Brave-Browser",
    win32: "BraveSoftware/Brave-Browser/User Data",
    safeStorageService: "Brave Safe Storage",
  },
  {
    id: "edge",
    label: "Microsoft Edge",
    darwin: "Microsoft Edge",
    linux: "microsoft-edge",
    win32: "Microsoft/Edge/User Data",
    safeStorageService: "Microsoft Edge Safe Storage",
  },
  {
    id: "vivaldi",
    label: "Vivaldi",
    darwin: "Vivaldi",
    linux: "vivaldi",
    win32: "Vivaldi/User Data",
    safeStorageService: "Vivaldi Safe Storage",
  },
]

export type DiscoveryEnvironment = {
  platform: SupportedPlatform
  home: string
  /** `%LOCALAPPDATA%`; only read on Windows. */
  localAppData?: string
}

export function currentDiscoveryEnvironment(): DiscoveryEnvironment | undefined {
  const platform = process.platform
  if (platform !== "darwin" && platform !== "linux" && platform !== "win32") {
    return undefined
  }
  return {
    platform,
    home: homedir(),
    localAppData: process.env.LOCALAPPDATA,
  }
}

function userDataDir(
  browser: BrowserDefinition,
  env: DiscoveryEnvironment
): string | undefined {
  if (env.platform === "darwin") {
    return join(env.home, "Library", "Application Support", browser.darwin)
  }
  if (env.platform === "linux") {
    return join(env.home, ".config", browser.linux)
  }
  const root = env.localAppData ?? join(env.home, "AppData", "Local")
  return join(root, browser.win32)
}

/** One browser profile with a readable cookie database. */
export type DetectedProfile = {
  browserId: BrowserId
  browserLabel: string
  /** Directory name, e.g. "Default" or "Profile 1". */
  profileDirectory: string
  /** Human name from the browser's own profile list, when it has one. */
  profileName: string
  cookiesPath: string
  /** The `User Data` root; where `Local State` and the Safe Storage key live. */
  userDataDir: string
  safeStorageService: string
}

// Chromium moved the per-profile cookie store under a Network directory in
// M96; older profiles keep it at the profile root. We accept either.
const cookieRelativePaths = [join("Network", "Cookies"), "Cookies"]

function cookiesPathFor(profileDir: string): string | undefined {
  for (const relative of cookieRelativePaths) {
    const candidate = join(profileDir, relative)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

// Only the profile display names are read; everything else in Local State is
// ignored. `catchall` lets the unrelated keys pass without widening.
const localStateSchema = z
  .object({
    profile: z
      .object({
        info_cache: z
          .record(z.string(), z.object({ name: z.string().min(1) }).partial())
          .catch({}),
      })
      .partial()
      .catch({}),
  })
  .partial()
  .catch({})

function profileNames(userData: string): Map<string, string> {
  const names = new Map<string, string>()
  let parsed: z.infer<typeof localStateSchema>
  try {
    const raw = readFileSync(join(userData, "Local State"), "utf8")
    parsed = localStateSchema.parse(JSON.parse(raw))
  } catch {
    // Local State is optional context; discovery falls back to directory names.
    return names
  }
  const cache = parsed.profile?.info_cache ?? {}
  for (const [dir, info] of Object.entries(cache)) {
    if (info.name) names.set(dir, info.name)
  }
  return names
}

function isProfileDirectory(name: string): boolean {
  return name === "Default" || name.startsWith("Profile ")
}

/**
 * Finds every profile with a cookie database across the known browsers. Reads
 * only directory listings and the plaintext `Local State`; it never opens a
 * cookie store. Returns an empty list on unsupported platforms.
 */
export function discoverBrowserProfiles(
  env: DiscoveryEnvironment | undefined = currentDiscoveryEnvironment()
): DetectedProfile[] {
  if (!env) return []
  const found: DetectedProfile[] = []

  for (const browser of browserDefinitions) {
    const userData = userDataDir(browser, env)
    if (!userData || !existsSync(userData)) continue

    const names = profileNames(userData)
    let entries: string[]
    try {
      entries = readdirSync(userData)
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!isProfileDirectory(entry)) continue
      const profileDir = join(userData, entry)
      try {
        if (!statSync(profileDir).isDirectory()) continue
      } catch {
        continue
      }
      const cookiesPath = cookiesPathFor(profileDir)
      if (!cookiesPath) continue

      found.push({
        browserId: browser.id,
        browserLabel: browser.label,
        profileDirectory: entry,
        profileName: names.get(entry) ?? entry,
        cookiesPath,
        userDataDir: userData,
        safeStorageService: browser.safeStorageService,
      })
    }
  }

  return found
}
