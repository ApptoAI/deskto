import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { browserProfilePath, measureBrowserProfile } from "./browser-profile.js"

describe("browser profile paths", () => {
  it("derives the partition folder Electron uses for a Workspace", () => {
    expect(browserProfilePath("/data", "personal")).toBe(
      path.join("/data", "Partitions", "workspace-personal")
    )
  })

  it("lower-cases and escapes ids the way Electron names partitions", () => {
    expect(browserProfilePath("/data", "Team A/B")).toBe(
      path.join("/data", "Partitions", "workspace-team%20a%2Fb")
    )
    expect(browserProfilePath("/data", "ws-1")).not.toBe(
      browserProfilePath("/data", "ws-2")
    )
  })
})

describe("measureBrowserProfile", () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "deskto-profile-"))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it("reports an absent profile as empty and never used", async () => {
    await expect(
      measureBrowserProfile(path.join(root, "missing"))
    ).resolves.toEqual({ sizeBytes: 0, lastUsedAt: null })
  })

  it("sums nested files and takes the newest write as last used", async () => {
    const profile = path.join(root, "workspace-personal")
    await mkdir(path.join(profile, "Local Storage"), { recursive: true })
    await writeFile(path.join(profile, "Cookies"), "abcd")
    const newest = path.join(profile, "Local Storage", "leveldb")
    await writeFile(newest, "0123456789")
    const old = new Date("2026-01-01T00:00:00.000Z")
    const recent = new Date("2026-08-30T12:00:00.000Z")
    await utimes(path.join(profile, "Cookies"), old, old)
    await utimes(newest, recent, recent)

    await expect(measureBrowserProfile(profile)).resolves.toEqual({
      sizeBytes: 14,
      lastUsedAt: recent.toISOString(),
    })
  })
})
