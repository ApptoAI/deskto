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
  const cipher = createCipheriv(
    "aes-128-cbc",
    peanutsKey,
    Buffer.alloc(16, " ")
  )
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
  /** Chromium microseconds since 1601; 0 (the default) is a session cookie. */
  expiresUtc?: bigint
  path?: string
  isSecure?: boolean
  isHttpOnly?: boolean
  /** Chromium's SameSite code: 0 none, 1 lax, 2 strict, -1 unspecified. */
  sameSite?: number
}

type SeedOptions = {
  platform?: DiscoveryEnvironment["platform"]
  databaseVersion?: number
}

function seedProfile(
  cookies: SeedCookie[],
  options: SeedOptions = {}
): DiscoveryEnvironment {
  root = join(tmpdir(), `deskto-import-${Math.random().toString(36).slice(2)}`)
  const platform = options.platform ?? "linux"
  const localAppData = join(root, "local-app-data")
  const profileDir =
    platform === "win32"
      ? join(localAppData, "Google", "Chrome", "User Data", "Default")
      : join(root, ".config", "google-chrome", "Default")
  mkdirSync(profileDir, { recursive: true })
  const database = new DatabaseSync(join(profileDir, "Cookies"))
  database.exec(
    `CREATE TABLE cookies (
      host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT,
      is_secure INTEGER, is_httponly INTEGER, samesite INTEGER, expires_utc INTEGER
    )`
  )
  if (options.databaseVersion !== undefined) {
    database.exec(
      "CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR)"
    )
    database
      .prepare("INSERT INTO meta (key, value) VALUES ('version', ?)")
      .run(String(options.databaseVersion))
  }
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
      cookie.path ?? "/",
      cookie.isSecure === false ? 0 : 1,
      cookie.isHttpOnly ? 1 : 0,
      cookie.sameSite ?? 0,
      cookie.expiresUtc ?? 0n
    )
  }
  database.close()
  return { platform, home: root, localAppData }
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
  it("imports the cookies that apply to the chosen host", async () => {
    const env = seedProfile([
      { hostKey: ".example.com", name: "sid", encrypted: sealV10("secret") },
      { hostKey: "example.com", name: "own", encrypted: sealV10("mine") },
      { hostKey: "sub.example.com", name: "sub", encrypted: sealV10("nested") },
      { hostKey: "other.test", name: "skip", encrypted: sealV10("no") },
    ])
    const { sink, written } = collectingSink()

    const result = await importCookies(
      { workspaceId: "ws-1", profileId: "chrome:Default", hosts: ["example.com"] },
      sink,
      env
    )

    // A host-only cookie on a subdomain is never sent to example.com, so it
    // stays behind even though the domain cookie comes along.
    expect(result).toEqual({ imported: 2, skipped: 0 })
    expect(written.map((cookie) => cookie.name).sort()).toEqual(["own", "sid"])
    expect(written.find((cookie) => cookie.name === "sid")?.domain).toBe(
      ".example.com"
    )
  })

  it("brings a parent domain cookie when a subdomain is chosen", async () => {
    const env = seedProfile([
      { hostKey: ".example.com", name: "sid", encrypted: sealV10("secret") },
      { hostKey: "example.com", name: "own", encrypted: sealV10("mine") },
      { hostKey: "app.example.com", name: "app", encrypted: sealV10("here") },
      { hostKey: "www.example.com", name: "www", encrypted: sealV10("no") },
    ])
    const { sink, written } = collectingSink()

    const result = await importCookies(
      {
        workspaceId: "ws-1",
        profileId: "chrome:Default",
        hosts: ["app.example.com"],
      },
      sink,
      env
    )

    expect(result).toEqual({ imported: 2, skipped: 0 })
    expect(written.map((cookie) => cookie.name).sort()).toEqual(["app", "sid"])
  })

  it("does not let a lookalike domain match", async () => {
    const env = seedProfile([
      { hostKey: ".notexample.com", name: "look", plaintext: "alike" },
    ])
    const { sink, written } = collectingSink()

    const result = await importCookies(
      {
        workspaceId: "ws-1",
        profileId: "chrome:Default",
        hosts: ["app.example.com"],
      },
      sink,
      env
    )

    expect(result).toEqual({ imported: 0, skipped: 0 })
    expect(written).toEqual([])
  })

  it("never writes a row whose host is a public suffix or a lookalike", async () => {
    const env = seedProfile([
      { hostKey: ".com", name: "suffix-domain", plaintext: "wide" },
      { hostKey: "com", name: "suffix-host", plaintext: "wide" },
      { hostKey: ".example.com.evil.test", name: "prefix", plaintext: "no" },
      { hostKey: ".xample.com", name: "tail", plaintext: "no" },
      { hostKey: "example.com", name: "own", plaintext: "yes" },
    ])
    const { sink, written } = collectingSink()

    const result = await importCookies(
      { workspaceId: "ws-1", profileId: "chrome:Default", hosts: ["example.com"] },
      sink,
      env
    )

    expect(result).toEqual({ imported: 1, skipped: 0 })
    expect(written.map((cookie) => cookie.name)).toEqual(["own"])
  })

  it("never lets a cookie path move the cookie URL to another host", async () => {
    // Paths without a leading slash are refused outright; the rest exercise
    // the URL pathname setter's quirks and must stay on example.com.
    const env = seedProfile([
      { hostKey: "example.com", name: "at", plaintext: "v", path: "@evil.com/" },
      { hostKey: "example.com", name: "bare", plaintext: "v", path: "evil.com/" },
      { hostKey: "example.com", name: "empty", plaintext: "v", path: "" },
      { hostKey: "example.com", name: "backslash", plaintext: "v", path: "/\\evil.test/" },
      { hostKey: "example.com", name: "encoded-slashes", plaintext: "v", path: "/%2f%2fevil.test/" },
      { hostKey: "example.com", name: "encoded-backslash", plaintext: "v", path: "/%5cevil.test/" },
      { hostKey: "example.com", name: "query", plaintext: "v", path: "/?x=1" },
      { hostKey: "example.com", name: "hash", plaintext: "v", path: "/#f" },
      { hostKey: "example.com", name: "space", plaintext: "v", path: "/a b" },
      { hostKey: "example.com", name: "at-in-path", plaintext: "v", path: "/@evil.test/" },
      { hostKey: "example.com", name: "ok", plaintext: "v", path: "/app" },
    ])
    const { sink, written } = collectingSink()

    const result = await importCookies(
      { workspaceId: "ws-1", profileId: "chrome:Default", hosts: ["example.com"] },
      sink,
      env
    )

    for (const cookie of written) {
      const url = new URL(cookie.url)
      expect(url.hostname).toBe("example.com")
      expect(url.username).toBe("")
      expect(url.password).toBe("")
      expect(url.port).toBe("")
    }
    expect(result).toEqual({ imported: written.length, skipped: 0 })
    expect(written.map((cookie) => [cookie.name, cookie.url])).toEqual([
      ["backslash", "https://example.com//evil.test/"],
      ["encoded-slashes", "https://example.com/%2f%2fevil.test/"],
      ["encoded-backslash", "https://example.com/%5cevil.test/"],
      ["query", "https://example.com/%3Fx=1"],
      ["hash", "https://example.com/%23f"],
      ["space", "https://example.com/a%20b"],
      ["at-in-path", "https://example.com/@evil.test/"],
      ["ok", "https://example.com/app"],
    ])
  })

  it("carries every cookie attribute through to the sink", async () => {
    // 2100-01-01 UTC in Chromium's epoch.
    const expires = 15_745_824_000n * 1_000_000n
    const env = seedProfile([
      {
        hostKey: ".example.com",
        name: "none",
        plaintext: "a",
        path: "/",
        isSecure: true,
        isHttpOnly: true,
        sameSite: 0,
        expiresUtc: expires,
      },
      {
        hostKey: "example.com",
        name: "lax",
        plaintext: "b",
        path: "/lax",
        isSecure: false,
        isHttpOnly: false,
        sameSite: 1,
      },
      {
        hostKey: "example.com",
        name: "strict",
        plaintext: "c",
        path: "/strict",
        isSecure: true,
        isHttpOnly: false,
        sameSite: 2,
      },
      {
        hostKey: "example.com",
        name: "unspecified",
        plaintext: "d",
        path: "/",
        isSecure: true,
        isHttpOnly: true,
        sameSite: -1,
      },
    ])
    const { sink, written } = collectingSink()

    const result = await importCookies(
      { workspaceId: "ws-1", profileId: "chrome:Default", hosts: ["example.com"] },
      sink,
      env
    )

    expect(result).toEqual({ imported: 4, skipped: 0 })
    const byName = new Map(written.map((cookie) => [cookie.name, cookie]))
    expect(byName.get("none")).toEqual({
      url: "https://example.com/",
      name: "none",
      value: "a",
      domain: ".example.com",
      path: "/",
      secure: true,
      httpOnly: true,
      expirationDate: 15_745_824_000 - 11_644_473_600,
      sameSite: "no_restriction",
    })
    expect(byName.get("lax")).toEqual({
      url: "http://example.com/lax",
      name: "lax",
      value: "b",
      domain: undefined,
      path: "/lax",
      secure: false,
      httpOnly: false,
      expirationDate: undefined,
      sameSite: "lax",
    })
    expect(byName.get("strict")).toEqual({
      url: "https://example.com/strict",
      name: "strict",
      value: "c",
      domain: undefined,
      path: "/strict",
      secure: true,
      httpOnly: false,
      expirationDate: undefined,
      sameSite: "strict",
    })
    expect(byName.get("unspecified")).toEqual({
      url: "https://example.com/",
      name: "unspecified",
      value: "d",
      domain: undefined,
      path: "/",
      secure: true,
      httpOnly: true,
      expirationDate: undefined,
      sameSite: "unspecified",
    })
  })

  it("ignores a public suffix even when a caller bypasses the schema", async () => {
    const env = seedProfile([
      { hostKey: ".example.com", name: "sid", plaintext: "secret" },
    ])
    const { sink, written } = collectingSink()

    const result = await importCookies(
      { workspaceId: "ws-1", profileId: "chrome:Default", hosts: ["com"] },
      sink,
      env
    )

    expect(result.error).toContain("website")
    expect(written).toEqual([])
  })

  it("leaves an expired cookie out of both counts", async () => {
    // 2001-01-01 UTC in Chromium's epoch, long past.
    const expired = 12_622_780_800n * 1_000_000n
    const env = seedProfile([
      {
        hostKey: "example.com",
        name: "old",
        encrypted: sealV10("stale"),
        expiresUtc: expired,
      },
      { hostKey: "example.com", name: "live", encrypted: sealV10("fresh") },
    ])
    const { sink, written } = collectingSink()

    const result = await importCookies(
      { workspaceId: "ws-1", profileId: "chrome:Default", hosts: ["example.com"] },
      sink,
      env
    )

    expect(result).toEqual({ imported: 1, skipped: 0 })
    expect(written.map((cookie) => cookie.name)).toEqual(["live"])
  })

  it("keeps a legacy plaintext value", async () => {
    const env = seedProfile([
      { hostKey: "example.com", name: "legacy", plaintext: "kept" },
    ])
    const { sink, written } = collectingSink()

    const result = await importCookies(
      { workspaceId: "ws-1", profileId: "chrome:Default", hosts: ["example.com"] },
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
      { workspaceId: "ws-1", profileId: "chrome:Default", hosts: ["example.com"] },
      sink,
      env
    )

    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.error).toBeDefined()
  })

  it("rejects unbound plaintext from a schema-v24 cookie database", async () => {
    const env = seedProfile(
      [
        {
          hostKey: "example.com",
          name: "sid",
          encrypted: sealV10("not-host-bound"),
        },
      ],
      { databaseVersion: 24 }
    )
    const { sink, written } = collectingSink()

    const result = await importCookies(
      { workspaceId: "ws-1", profileId: "chrome:Default", hosts: ["example.com"] },
      sink,
      env
    )

    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(1)
    expect(written).toEqual([])
  })

  it("reports Windows App-Bound cookies as unsupported", async () => {
    const env = seedProfile(
      [
        {
          hostKey: "example.com",
          name: "sid",
          encrypted: Buffer.concat([Buffer.from("v20"), Buffer.alloc(32)]),
        },
      ],
      { platform: "win32", databaseVersion: 24 }
    )
    const { sink, written } = collectingSink()

    const result = await importCookies(
      { workspaceId: "ws-1", profileId: "chrome:Default", hosts: ["example.com"] },
      sink,
      env
    )

    expect(result).toMatchObject({ imported: 0, skipped: 1 })
    expect(result.error).toContain("Windows App-Bound Encryption")
    expect(written).toEqual([])
  })

  it("stops before reading when the task browser isolates every session", async () => {
    const env = seedProfile([
      { hostKey: "example.com", name: "sid", plaintext: "kept" },
    ])
    const result = await importCookies(
      { workspaceId: "ws-1", profileId: "chrome:Default", hosts: ["example.com"] },
      {
        unavailableReason:
          "Turn off Clear session between tasks to use imported cookies.",
      },
      env
    )

    expect(result.error).toContain("Clear session between tasks")
  })

  it("asks for at least one website when none are chosen", async () => {
    const env = seedProfile([])
    const { sink } = collectingSink()

    const result = await importCookies(
      { workspaceId: "ws-1", profileId: "chrome:Default", hosts: [] },
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
