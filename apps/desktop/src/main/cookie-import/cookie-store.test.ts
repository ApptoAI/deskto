import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { afterEach, describe, expect, it } from "vitest"

import {
  expirationSeconds,
  readRawCookies,
  sameSiteValue,
} from "./cookie-store.js"

let workDir: string | undefined

afterEach(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true })
  workDir = undefined
})

// Writes a minimal Chromium-shaped Cookies database and returns its path.
function fixtureCookies(): string {
  workDir = mkdtempSync(join(tmpdir(), "deskto-cookie-fixture-"))
  const path = join(workDir, "Cookies")
  const database = new DatabaseSync(path)
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
  insert.run(".example.com", "sid", "", Buffer.from("v10secret"), "/", 1, 1, 2, 13_300_000_000_000_000)
  insert.run("plain.test", "legacy", "kept", null, "/app", 0, 0, 0, 0)
  database.close()
  return path
}

describe("readRawCookies", () => {
  it("reads rows without opening the live file in place", () => {
    const rows = readRawCookies(fixtureCookies())

    expect(rows).toHaveLength(2)
    const [secure, legacy] = rows
    expect(secure).toMatchObject({
      hostKey: ".example.com",
      name: "sid",
      plaintextValue: "",
      path: "/",
      isSecure: true,
      isHttpOnly: true,
      sameSite: 2,
    })
    expect(secure?.encryptedValue.toString("utf8")).toBe("v10secret")
    expect(legacy).toMatchObject({
      hostKey: "plain.test",
      plaintextValue: "kept",
      isSecure: false,
    })
    expect(legacy?.encryptedValue).toHaveLength(0)
  })
})

describe("expirationSeconds", () => {
  it("converts Chromium's 1601-epoch microseconds to Unix seconds", () => {
    // 13_300_000_000 seconds after 1601 lands in 2022.
    expect(expirationSeconds(13_300_000_000_000_000n)).toBeCloseTo(
      13_300_000_000 - 11_644_473_600
    )
  })

  it("treats a zero expiry as a session cookie", () => {
    expect(expirationSeconds(0n)).toBeUndefined()
  })
})

describe("sameSiteValue", () => {
  it("maps Chromium's codes to Electron's values", () => {
    expect(sameSiteValue(-1)).toBe("unspecified")
    expect(sameSiteValue(0)).toBe("no_restriction")
    expect(sameSiteValue(1)).toBe("lax")
    expect(sameSiteValue(2)).toBe("strict")
  })
})
