import { createDecipheriv, createHash, pbkdf2Sync } from "node:crypto"

// Chromium encrypts every stored cookie value with a per-platform scheme. The
// bytes carry a version tag: "v10"/"v11" on Linux and macOS use AES-128-CBC,
// "v10" on Windows uses AES-256-GCM, and an untagged value on Windows is raw
// DPAPI. These constants are Chromium's, not ours, and cannot change here.
const cbcSalt = "saltysalt"
const cbcIv = Buffer.alloc(16, " ")
const cbcKeyLength = 16
const gcmNonceLength = 12
const gcmTagLength = 16
// Recent Chromium prepends SHA-256(host_key) to the plaintext before
// encrypting, so a decrypted value that leaks cannot be replayed against a
// different host. We drop it only when it matches the cookie's own host.
const domainHashLength = 32

const versionPrefixLength = 3

export type CookieCipherScheme = "cbc" | "gcm"

/**
 * Derives the AES-128-CBC key Linux and macOS use from a Safe Storage
 * password. Linux's basic "peanuts" password uses one iteration; macOS's
 * keychain password uses 1003. Both share Chromium's fixed salt.
 */
export function deriveCbcKey(password: string, iterations: number): Buffer {
  return pbkdf2Sync(password, cbcSalt, iterations, cbcKeyLength, "sha1")
}

function versionTag(encrypted: Buffer): string | undefined {
  if (encrypted.length < versionPrefixLength) return undefined
  const tag = encrypted.subarray(0, versionPrefixLength).toString("latin1")
  return tag === "v10" || tag === "v11" ? tag : undefined
}

function stripDomainHash(plaintext: Buffer, hostKey: string): Buffer {
  if (plaintext.length < domainHashLength) return plaintext
  const expected = createHash("sha256").update(hostKey).digest()
  const prefix = plaintext.subarray(0, domainHashLength)
  return prefix.equals(expected)
    ? plaintext.subarray(domainHashLength)
    : plaintext
}

function decryptCbc(encrypted: Buffer, key: Buffer): Buffer {
  const body = encrypted.subarray(versionPrefixLength)
  const decipher = createDecipheriv("aes-128-cbc", key, cbcIv)
  // Chromium's CBC padding is not always well-formed after a partial write,
  // so we unpad by hand rather than let the cipher throw on the final block.
  decipher.setAutoPadding(false)
  const padded = Buffer.concat([decipher.update(body), decipher.final()])
  return unpadPkcs7(padded)
}

function unpadPkcs7(buffer: Buffer): Buffer {
  const last = buffer.at(-1)
  if (last === undefined || last < 1 || last > 16 || last > buffer.length) {
    return buffer
  }
  return buffer.subarray(0, buffer.length - last)
}

function decryptGcm(encrypted: Buffer, key: Buffer): Buffer {
  const nonce = encrypted.subarray(
    versionPrefixLength,
    versionPrefixLength + gcmNonceLength
  )
  const tagStart = encrypted.length - gcmTagLength
  const ciphertext = encrypted.subarray(
    versionPrefixLength + gcmNonceLength,
    tagStart
  )
  const tag = encrypted.subarray(tagStart)
  const decipher = createDecipheriv("aes-256-gcm", key, nonce)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

/**
 * Decrypts one stored cookie value. `hostKey` is the cookie's host, used only
 * to recognise and drop Chromium's domain-hash prefix. Throws when the value
 * is untagged on a CBC platform, since that means an OS-native (DPAPI or
 * keychain-wrapped) blob this path cannot open.
 */
export function decryptCookieValue(options: {
  encrypted: Buffer
  key: Buffer
  scheme: CookieCipherScheme
  hostKey: string
}): string {
  const { encrypted, key, scheme, hostKey } = options
  if (encrypted.length === 0) return ""

  const tag = versionTag(encrypted)
  if (tag === undefined) {
    // A plain, unencrypted value is stored with an empty encrypted blob and a
    // populated plaintext column, handled by the caller. Reaching here means
    // an encrypted blob in a scheme we do not recognise.
    throw new Error("This cookie uses an unsupported encryption format.")
  }

  const plaintext =
    scheme === "gcm" ? decryptGcm(encrypted, key) : decryptCbc(encrypted, key)
  return stripDomainHash(plaintext, hostKey).toString("utf8")
}
