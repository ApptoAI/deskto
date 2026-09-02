import { createCipheriv, createHash, randomBytes } from "node:crypto"
import { describe, expect, it } from "vitest"

import { decryptCookieValue, deriveCbcKey } from "./decrypt.js"

const cbcIv = Buffer.alloc(16, " ")

function encryptCbc(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv("aes-128-cbc", key, cbcIv)
  return Buffer.concat([
    Buffer.from("v10"),
    cipher.update(plaintext),
    cipher.final(),
  ])
}

function encryptCbcWithoutPadding(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv("aes-128-cbc", key, cbcIv)
  cipher.setAutoPadding(false)
  return Buffer.concat([
    Buffer.from("v10"),
    cipher.update(plaintext),
    cipher.final(),
  ])
}

function encryptGcm(plaintext: Buffer, key: Buffer): Buffer {
  const nonce = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, nonce)
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([Buffer.from("v10"), nonce, body, cipher.getAuthTag()])
}

describe("decryptCookieValue", () => {
  it("reads a Linux v10 value sealed with the peanuts password", () => {
    const key = deriveCbcKey("peanuts", 1)
    const encrypted = encryptCbc(Buffer.from("session=abc123"), key)

    expect(
      decryptCookieValue({
        encrypted,
        key,
        scheme: "cbc",
        hostKey: "example.com",
      })
    ).toBe("session=abc123")
  })

  it("drops the domain-hash prefix when it matches the cookie host", () => {
    const key = deriveCbcKey("peanuts", 1)
    const hostKey = "app.example.com"
    const prefixed = Buffer.concat([
      createHash("sha256").update(hostKey).digest(),
      Buffer.from("token=xyz"),
    ])

    expect(
      decryptCookieValue({
        encrypted: encryptCbc(prefixed, key),
        key,
        scheme: "cbc",
        hostKey,
        databaseVersion: 24,
      })
    ).toBe("token=xyz")
  })

  it("rejects a missing or mismatched host hash for schema version 24", () => {
    const key = deriveCbcKey("peanuts", 1)

    expect(() =>
      decryptCookieValue({
        encrypted: encryptCbc(Buffer.from("not a host-bound value"), key),
        key,
        scheme: "cbc",
        hostKey: "example.com",
        databaseVersion: 24,
      })
    ).toThrow("stored host")
  })

  it("keeps a leading 32 bytes that are not the host hash", () => {
    const key = deriveCbcKey("peanuts", 1)
    const value = "x".repeat(32) + "=keep"

    expect(
      decryptCookieValue({
        encrypted: encryptCbc(Buffer.from(value), key),
        key,
        scheme: "cbc",
        hostKey: "example.com",
      })
    ).toBe(value)
  })

  it("reads a Windows-style v10 AES-256-GCM value", () => {
    const key = randomBytes(32)
    const encrypted = encryptGcm(Buffer.from("id=42"), key)

    expect(
      decryptCookieValue({
        encrypted,
        key,
        scheme: "gcm",
        hostKey: "example.com",
      })
    ).toBe("id=42")
  })

  it("rejects malformed PKCS#7 padding", () => {
    const key = deriveCbcKey("peanuts", 1)
    const malformed = Buffer.concat([Buffer.alloc(14, 1), Buffer.from([1, 2])])

    expect(() =>
      decryptCookieValue({
        encrypted: encryptCbcWithoutPadding(malformed, key),
        key,
        scheme: "cbc",
        hostKey: "example.com",
      })
    ).toThrow("padding")
  })

  it("rejects a wrong CBC key for a schema-v24 cookie", () => {
    const encryptionKey = Buffer.alloc(16, 7)
    const wrongKey = Buffer.alloc(16, 9)
    const hostKey = "example.com"
    const plaintext = Buffer.concat([
      createHash("sha256").update(hostKey).digest(),
      Buffer.from("session=abc123"),
    ])

    expect(() =>
      decryptCookieValue({
        encrypted: encryptCbc(plaintext, encryptionKey),
        key: wrongKey,
        scheme: "cbc",
        hostKey,
        databaseVersion: 24,
      })
    ).toThrow()
  })

  it("rejects a blob with no recognised version tag", () => {
    expect(() =>
      decryptCookieValue({
        encrypted: Buffer.from("plainbytes"),
        key: deriveCbcKey("peanuts", 1),
        scheme: "cbc",
        hostKey: "example.com",
      })
    ).toThrow()
  })

  it("returns empty for an empty blob", () => {
    expect(
      decryptCookieValue({
        encrypted: Buffer.alloc(0),
        key: deriveCbcKey("peanuts", 1),
        scheme: "cbc",
        hostKey: "example.com",
      })
    ).toBe("")
  })
})
