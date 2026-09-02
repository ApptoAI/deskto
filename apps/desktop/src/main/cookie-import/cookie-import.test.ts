import { createCipheriv } from "node:crypto"
import { mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { afterEach, describe, expect, it } from "vitest"

import type { DiscoveryEnvironment } from "./browsers.js"
import {
  importCookies,
  listImportableProfiles,
  type CookieSink,
  type ImportableCookie,
} from "./cookie-import.js"
import { deriveCbcKey } from "./decrypt.js"

let root: string | undefined

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true })
  root = undefined
})

const peanutsKey = deriveCbcKey("peanuts", 1)

function sealV10(value: string): Buffer {
  const cipher = createCipheriv("aes-128-cbc", peanutsKey, Buffer.alloc(16, " "))
  return Buffer.concat([
    Buffer.from("v10"),
    cipher.update(value, "utf8"),
    cipher.final(),
  ])
}

type SeedCookie = {
  hostKey: string
  name: string
  encrypted?: Buffer
  plaintext?: string
}

function seedProfile(cookies: SeedCookie[]): DiscoveryEnvironment {
  root = join(tmpdir(), `deskto-import-${Math.random().toString(36).slice(2)}`)
  const profileDir = join(root, ".config", "google-chrome", "Default")
  mkdirSync(profileDir, { recursive: true })
  const database = new DatabaseSync(join(profileDir, "Cookies"))
  database.exec(
    `CREATE TABLE cookies (
      host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT,
      is_secure INTEGER, is_httponly INTEGER, samesite INTEGER, expires_utc INTEGER
    )`
  )
  const insert = database.prepare(
    `INSERT INTO cookies
      (host_key, name, value, encrypted_value, path, is_secure, is_httponly, samesite, expires_utc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const cookie of cookies) {
    insert.run(
      cookie.hostKey,
      cookie.name,
      cookie.plaintext ?? "",
      cookie.encrypted ?? null,
      "/",
      1,
      0,
      0,
      0
    )
  }
  database.close()
  return { platform: "linux", home: root }
}

function collectingSink() {
  const written: ImportableCookie[] = []
  const sink: CookieSink = {
    set: (cookie) => {
      written.push(cookie)
      return Promise.resolve()
    },
  }
  return { sink, written }
}

describe("importCookies", () => {
  it("decrypts and writes cookies for the chosen host and its subdomains", async () => {
    const env = seedProfile([
      { hostKey: ".example.com", name: "sid", encrypted: sealV10("secret") },
      { hostKey: "sub.example.com", name: "sub", encrypted: sealV10("nested") },
      { hostKey: "other.test", name: "skip", encrypted: sealV10("no") },
    ])
    const { sink, written } = collectingSink()

    const result = await importCookies(
      { profileId: "chrome:Default", hosts: ["example.com"] },
      sink,
      env
    )

    expect(result).toEqual({ imported: 2, skipped: 0 })
    expect(written.map((cookie) => cookie.value).sort()).toEqual([
      "nested",
      "secret",
    ])
    expect(written.some((cookie) => cookie.name === "skip")).toBe(false)
  })

  it("keeps a legacy plaintext value", async () => {
    const env = seedProfile([
      { hostKey: "example.com", name: "legacy", plaintext: "kept" },
    ])
    const { sink, written } = collectingSink()

    const result = await importCookies(
      { profileId: "chrome:Default", hosts: ["example.com"] },
      sink,
      env
    )

    expect(result.imported).toBe(1)
    expect(written[0]?.value).toBe("kept")
  })

  it("reports a next step when no value could be decrypted", async () => {
    // A truncated blob cannot be decrypted with any key, standing in for a
    // value sealed by a scheme this machine cannot open.
    const env = seedProfile([
      {
        hostKey: "example.com",
        name: "sid",
        encrypted: Buffer.concat([Buffer.from("v10"), Buffer.alloc(5)]),
      },
    ])
    const { sink } = collectingSink()

    const result = await importCookies(
      { profileId: "chrome:Default", hosts: ["example.com"] },
      sink,
      env
    )

    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.error).toBeDefined()
  })

  it("asks for at least one website when none are chosen", async () => {
    const env = seedProfile([])
    const { sink } = collectingSink()

    const result = await importCookies(
      { profileId: "chrome:Default", hosts: [] },
      sink,
      env
    )

    expect(result.error).toContain("website")
  })

  it("lists the seeded profile", () => {
    const env = seedProfile([
      { hostKey: "example.com", name: "sid", plaintext: "v" },
    ])

    const profiles = listImportableProfiles(env)

    expect(profiles).toHaveLength(1)
    expect(profiles[0]?.id).toBe("chrome:Default")
  })
})
