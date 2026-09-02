import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { discoverBrowserProfiles } from "./browsers.js"

let home: string | undefined

afterEach(() => {
  if (home) rmSync(home, { recursive: true, force: true })
  home = undefined
})

function fakeHome(): string {
  home = mkdtempSync()
  return home
}

function mkdtempSync(): string {
  const dir = join(tmpdir(), `deskto-home-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function writeCookies(dir: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "Cookies"), "")
}

describe("discoverBrowserProfiles", () => {
  it("finds Linux Chrome profiles and reads their display names", () => {
    const root = fakeHome()
    const chrome = join(root, ".config", "google-chrome")
    writeCookies(join(chrome, "Default"))
    // A newer profile keeps its store under Network/.
    writeCookies(join(chrome, "Profile 1", "Network"))
    writeFileSync(
      join(chrome, "Local State"),
      JSON.stringify({
        profile: {
          info_cache: {
            Default: { name: "Personal" },
            "Profile 1": { name: "Work" },
          },
        },
      })
    )

    const profiles = discoverBrowserProfiles({ platform: "linux", home: root })

    expect(profiles).toHaveLength(2)
    expect(profiles.map((profile) => profile.profileName).sort()).toEqual([
      "Personal",
      "Work",
    ])
    expect(profiles.every((profile) => profile.browserId === "chrome")).toBe(
      true
    )
  })

  it("ignores a profile with no cookie store and unknown browsers", () => {
    const root = fakeHome()
    // Brave present with a cookie store; Chromium present but empty.
    writeCookies(join(root, ".config", "BraveSoftware", "Brave-Browser", "Default"))
    mkdirSync(join(root, ".config", "chromium", "Default"), { recursive: true })

    const profiles = discoverBrowserProfiles({ platform: "linux", home: root })

    expect(profiles).toHaveLength(1)
    expect(profiles[0]?.browserId).toBe("brave")
  })

  it("falls back to the directory name without Local State", () => {
    const root = fakeHome()
    writeCookies(join(root, ".config", "vivaldi", "Default"))

    const profiles = discoverBrowserProfiles({ platform: "linux", home: root })

    expect(profiles[0]?.profileName).toBe("Default")
  })
})
