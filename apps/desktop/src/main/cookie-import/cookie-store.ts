import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { DatabaseSync } from "node:sqlite"

// Chromium stores timestamps as microseconds since 1601-01-01 UTC. Electron's
// cookie API wants seconds since the Unix epoch, 11644473600 seconds later.
const windowsEpochOffsetSeconds = 11_644_473_600
const microsecondsPerSecond = 1_000_000n

/** A cookie row as Chromium stores it, before any value is decrypted. */
export type RawCookie = {
  hostKey: string
  name: string
  /** Legacy plaintext value; empty once Chromium encrypts the cookie. */
  plaintextValue: string
  encryptedValue: Buffer
  path: string
  isSecure: boolean
  isHttpOnly: boolean
  /** Chromium's code: -1 unspecified, 0 none, 1 lax, 2 strict. */
  sameSite: number
  /** Microseconds since 1601; 0 for a session cookie. Read as bigint because a
   * real expiry exceeds JavaScript's safe-integer range. */
  expiresUtc: bigint
  /** Chromium's cookie schema version from meta.version, when present. */
  databaseVersion?: number
}

function toBuffer(value: Uint8Array | null): Buffer {
  return value ? Buffer.from(value) : Buffer.alloc(0)
}

/**
 * Copies the profile's cookie database to a private temporary file and reads
 * every row. Chromium keeps the live file locked while the browser runs, so it
 * is never opened in place. The copy, and its WAL sidecars, are deleted before
 * returning.
 */
export function readRawCookies(cookiesPath: string): RawCookie[] {
  const workDir = mkdtempSync(join(tmpdir(), "deskto-cookies-"))
  const target = join(workDir, basename(cookiesPath))
  try {
    copyFileSync(cookiesPath, target)
    for (const suffix of ["-wal", "-shm"]) {
      const sidecar = `${cookiesPath}${suffix}`
      if (existsSync(sidecar)) copyFileSync(sidecar, `${target}${suffix}`)
    }
    return readCopiedCookies(target)
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

// The SELECT below pins each column's storage class, so a row matches this
// shape: TEXT columns come back as strings, INTEGER as bigints (expiries run
// past the safe-integer range), and the BLOB as bytes or NULL.
type CookieRow = {
  host_key: string
  name: string
  value: string
  encrypted_value: Uint8Array | null
  path: string
  is_secure: bigint
  is_httponly: bigint
  samesite: bigint
  expires_utc: bigint
}

function readCopiedCookies(databasePath: string): RawCookie[] {
  const database = new DatabaseSync(databasePath, { readOnly: true })
  try {
    const databaseVersion = readDatabaseVersion(database)
    const statement = database.prepare(
      `SELECT host_key, name, value, encrypted_value, path,
              is_secure, is_httponly, samesite, expires_utc
       FROM cookies`
    )
    statement.setReadBigInts(true)
    // SAFETY: the query names TEXT, INTEGER, and BLOB columns of Chromium's
    // cookies table, and setReadBigInts makes every INTEGER a bigint, so each
    // row conforms to CookieRow.
    const rows = statement.all() as CookieRow[]
    return rows.map((row) => readRow(row, databaseVersion))
  } finally {
    database.close()
  }
}

function readDatabaseVersion(database: DatabaseSync): number | undefined {
  try {
    const statement = database.prepare(
      "SELECT CAST(value AS TEXT) AS value FROM meta WHERE key = 'version'"
    )
    // SAFETY: CAST pins the selected SQLite value to TEXT.
    const row = statement.get() as { value: string } | undefined
    if (!row) return undefined
    const version = Number(row.value)
    return Number.isSafeInteger(version) && version >= 0 ? version : undefined
  } catch {
    // Older Chromium databases may not have a meta table.
    return undefined
  }
}

function readRow(
  row: CookieRow,
  databaseVersion: number | undefined
): RawCookie {
  return {
    hostKey: row.host_key,
    name: row.name,
    plaintextValue: row.value,
    encryptedValue: toBuffer(row.encrypted_value),
    path: row.path,
    isSecure: row.is_secure !== 0n,
    isHttpOnly: row.is_httponly !== 0n,
    sameSite: Number(row.samesite),
    expiresUtc: row.expires_utc,
    databaseVersion,
  }
}

/**
 * Converts Chromium's expiry to a Unix-seconds expiration for Electron, or
 * undefined for a session cookie that should not outlive the session.
 */
export function expirationSeconds(expiresUtc: bigint): number | undefined {
  if (expiresUtc <= 0n) return undefined
  return Number(expiresUtc / microsecondsPerSecond) - windowsEpochOffsetSeconds
}

/** Maps Chromium's SameSite code to Electron's cookie SameSite value. */
export function sameSiteValue(
  code: number
): "unspecified" | "no_restriction" | "lax" | "strict" {
  if (code === 0) return "no_restriction"
  if (code === 1) return "lax"
  if (code === 2) return "strict"
  return "unspecified"
}
