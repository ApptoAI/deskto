import {
  isCookieImportHost,
  normalizeCookieImportHost,
} from "@deskto/protocol"

import type {
  CookieImportRequest,
  CookieImportResult,
  DetectedBrowserProfile,
} from "../../shared/desktop-api.js"
import {
  currentDiscoveryEnvironment,
  discoverBrowserProfiles,
  type DetectedProfile,
  type DiscoveryEnvironment,
} from "./browsers.js"
import {
  expirationSeconds,
  readRawCookies,
  sameSiteValue,
  type RawCookie,
} from "./cookie-store.js"
import { decryptCookieValue } from "./decrypt.js"
import { resolveCookieCrypto, type CookieVersion } from "./keys.js"

/** The subset of Electron's cookie details the importer writes. */
export type ImportableCookie = {
  url: string
  name: string
  value: string
  domain?: string
  path: string
  secure: boolean
  httpOnly: boolean
  expirationDate?: number
  sameSite: "unspecified" | "no_restriction" | "lax" | "strict"
}

/** Where imported cookies are written; one Workspace's browser profile session. */
export type CookieSink =
  | {
      /** A settings conflict that prevents cookies reaching task tabs. */
      unavailableReason: string
    }
  | {
      unavailableReason?: never
      set(cookie: ImportableCookie): Promise<void>
    }

function profileId(profile: DetectedProfile): string {
  return `${profile.browserId}:${profile.profileDirectory}`
}

function toDetected(profile: DetectedProfile): DetectedBrowserProfile {
  return {
    id: profileId(profile),
    browserId: profile.browserId,
    browserLabel: profile.browserLabel,
    profileDirectory: profile.profileDirectory,
    profileName: profile.profileName,
  }
}

export function listImportableProfiles(
  env: DiscoveryEnvironment | undefined = currentDiscoveryEnvironment()
): DetectedBrowserProfile[] {
  return discoverBrowserProfiles(env).map(toDetected)
}

// Chromium stores a domain cookie with a leading dot and a host-only cookie
// without one. A cookie is imported when it would be sent to a chosen host:
// a host-only cookie only to that exact host, a domain cookie to the domain
// and everything below it. Choosing "example.com" therefore never brings
// host-only cookies from its subdomains, and choosing "app.example.com"
// brings the ".example.com" cookies that apply to it.
function hostMatches(cookieHostKey: string, chosen: ReadonlySet<string>): boolean {
  // The browser database is untrusted input: a row whose host is a public
  // suffix such as ".com" would otherwise match every chosen host under it.
  if (!isCookieImportHost(cookieHostKey)) return false
  const host = normalizeCookieImportHost(cookieHostKey)
  if (!cookieHostKey.startsWith(".")) return chosen.has(host)
  for (const target of chosen) {
    if (target === host || target.endsWith(`.${host}`)) return true
  }
  return false
}

type StoredCookieVersion = CookieVersion | "v20"

function cookieVersion(encrypted: Buffer): StoredCookieVersion | undefined {
  const tag = encrypted.subarray(0, 3).toString("latin1")
  return tag === "v10" || tag === "v11" || tag === "v20" ? tag : undefined
}

// A cookie path is a URL path and nothing else. Chromium writes it that way,
// but the row is untrusted, so a path carrying "@", "?", "#" or whitespace is
// refused rather than let it reshape the URL the cookie is set against.
const cookiePathPattern = /^\/[^@?#\s]*$/u

function cookieUrl(cookie: RawCookie): URL | undefined {
  if (!isCookieImportHost(cookie.hostKey)) return undefined
  if (!cookiePathPattern.test(cookie.path)) return undefined
  const host = normalizeCookieImportHost(cookie.hostKey)
  const url = new URL(`${cookie.isSecure ? "https" : "http"}://${host}`)
  url.pathname = cookie.path
  if (url.hostname !== host || url.username || url.password || url.port) {
    return undefined
  }
  return url
}

function importableCookie(
  cookie: RawCookie,
  value: string
): ImportableCookie | undefined {
  const url = cookieUrl(cookie)
  if (!url) return undefined
  const isDomainCookie = cookie.hostKey.startsWith(".")
  return {
    url: url.href,
    name: cookie.name,
    value,
    domain: isDomainCookie ? cookie.hostKey : undefined,
    path: cookie.path,
    secure: cookie.isSecure,
    httpOnly: cookie.isHttpOnly,
    expirationDate: expirationSeconds(cookie.expiresUtc),
    sameSite: sameSiteValue(cookie.sameSite),
  }
}

/**
 * Reads one profile's cookie store, decrypts the values this machine can, and
 * writes those matching the chosen hosts into the sink. Decrypted values live
 * only in memory for the length of the write; nothing is logged or persisted.
 */
export async function importCookies(
  request: CookieImportRequest,
  sink: CookieSink,
  env: DiscoveryEnvironment | undefined = currentDiscoveryEnvironment()
): Promise<CookieImportResult> {
  if (!env) {
    return { imported: 0, skipped: 0, error: cannotRunHereMessage }
  }
  if ("unavailableReason" in sink) {
    return { imported: 0, skipped: 0, error: sink.unavailableReason }
  }
  // The IPC schema already enforces this; it stays here so no other caller
  // can widen the import to a public suffix.
  const chosen = new Set(
    request.hosts.filter(isCookieImportHost).map(normalizeCookieImportHost)
  )
  if (chosen.size === 0) {
    return { imported: 0, skipped: 0, error: "Choose at least one website." }
  }

  const profile = discoverBrowserProfiles(env).find(
    (candidate) => profileId(candidate) === request.profileId
  )
  if (!profile) {
    return { imported: 0, skipped: 0, error: profileGoneMessage }
  }

  let rows: RawCookie[]
  try {
    rows = readRawCookies(profile.cookiesPath)
  } catch {
    return {
      imported: 0,
      skipped: 0,
      error: `Close ${profile.browserLabel} and try the import again.`,
    }
  }

  const crypto = resolveCookieCrypto(env, profile)
  let imported = 0
  let skipped = 0
  let appBoundSkipped = 0

  const nowSeconds = Date.now() / 1000
  for (const cookie of rows) {
    if (!hostMatches(cookie.hostKey, chosen)) continue
    // Chromium keeps expired rows until its next cleanup; the session would
    // drop them on write, so they count as neither imported nor skipped.
    const expiresAt = expirationSeconds(cookie.expiresUtc)
    if (expiresAt !== undefined && expiresAt <= nowSeconds) continue

    const version = cookieVersion(cookie.encryptedValue)
    if (env.platform === "win32" && version === "v20") {
      skipped += 1
      appBoundSkipped += 1
      continue
    }

    const value = decryptValue(cookie, crypto, version)
    if (value === undefined) {
      skipped += 1
      continue
    }
    const importable = importableCookie(cookie, value)
    if (!importable) continue
    try {
      await sink.set(importable)
      imported += 1
    } catch {
      skipped += 1
    }
  }

  if (appBoundSkipped > 0) {
    return {
      imported,
      skipped,
      error: appBoundEncryptionMessage(imported),
    }
  }
  if (imported === 0 && skipped > 0) {
    return { imported, skipped, error: keyAccessMessage(env) }
  }
  return { imported, skipped }
}

function decryptValue(
  cookie: RawCookie,
  crypto: ReturnType<typeof resolveCookieCrypto>,
  version = cookieVersion(cookie.encryptedValue)
): string | undefined {
  if (cookie.encryptedValue.length === 0) return cookie.plaintextValue

  if (!version || version === "v20") return undefined
  const key = crypto.keyForVersion(version)
  if (!key) return undefined

  try {
    return decryptCookieValue({
      encrypted: cookie.encryptedValue,
      key,
      scheme: crypto.scheme,
      hostKey: cookie.hostKey,
      databaseVersion: cookie.databaseVersion,
    })
  } catch {
    return undefined
  }
}

const cannotRunHereMessage =
  "Cookie import runs on macOS, Windows, and Linux desktops only."
const profileGoneMessage =
  "That browser profile is no longer available. Refresh the list and try again."

function appBoundEncryptionMessage(imported: number): string {
  const prefix =
    imported > 0 ? `Imported ${imported} older-format cookies, but ` : ""
  return `${prefix}this browser profile uses Windows App-Bound Encryption, which Deskto cannot import yet. Sign in again in Deskto's built-in browser.`
}

function keyAccessMessage(env: DiscoveryEnvironment): string {
  if (env.platform === "darwin") {
    return "Deskto could not read the browser's key. Grant keychain access when macOS asks, then try again."
  }
  if (env.platform === "linux") {
    return "Deskto could not unlock the browser's keyring. Unlock your login keyring and try again."
  }
  return "Deskto could not read the browser's key. Sign in as the account that uses this browser and try again."
}
