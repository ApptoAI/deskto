import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { z } from "zod"

import type { DiscoveryEnvironment } from "./browsers.js"
import { deriveCbcKey, type CookieCipherScheme } from "./decrypt.js"

// PBKDF2 iteration counts Chromium fixes per platform for its CBC key.
const linuxIterations = 1
const macIterations = 1_003
// Chromium's Linux "peanuts" password protects a v10 cookie when no keyring is
// available; a v11 cookie's password lives in the OS keyring instead.
const linuxDefaultPassword = "peanuts"
// The Local State master key is DPAPI-wrapped with this ASCII prefix.
const dpapiPrefix = "DPAPI"

export type CookieVersion = "v10" | "v11"

/**
 * Resolves the key material a profile needs to decrypt its cookies. `scheme`
 * is the cipher for this platform; `keyForVersion` returns the AES key for one
 * version tag, or undefined when this machine cannot supply it (for example a
 * v11 cookie with no reachable keyring).
 */
export type CookieCrypto = {
  scheme: CookieCipherScheme
  keyForVersion(version: CookieVersion): Buffer | undefined
}

function keychainPassword(service: string): string | undefined {
  // The account is the product name Chromium stores the key under, which is
  // the service name without its " Safe Storage" suffix.
  const account = service.replace(/ Safe Storage$/u, "")
  try {
    const output = execFileSync(
      "security",
      ["find-generic-password", "-w", "-s", service, "-a", account],
      { encoding: "utf8" }
    )
    const password = output.replace(/\n$/u, "")
    return password.length > 0 ? password : undefined
  } catch {
    return undefined
  }
}

// The keyring app label Chromium looks its Linux password up under.
const linuxKeyringApps = new Map<string, string>([
  ["Chrome Safe Storage", "chrome"],
  ["Chromium Safe Storage", "chromium"],
  ["Brave Safe Storage", "brave"],
  ["Microsoft Edge Safe Storage", "chrome"],
  ["Vivaldi Safe Storage", "vivaldi"],
])

function linuxKeyringPassword(service: string): string | undefined {
  const application = linuxKeyringApps.get(service)
  if (!application) return undefined
  try {
    const output = execFileSync(
      "secret-tool",
      ["lookup", "application", application],
      { encoding: "utf8" }
    )
    return output.length > 0 ? output : undefined
  } catch {
    return undefined
  }
}

const localStateKeySchema = z
  .object({ os_crypt: z.object({ encrypted_key: z.string() }).partial() })
  .partial()

function windowsMasterKey(userDataDir: string): Buffer | undefined {
  let encryptedKey: string | undefined
  try {
    const raw = readFileSync(join(userDataDir, "Local State"), "utf8")
    encryptedKey = localStateKeySchema.parse(JSON.parse(raw)).os_crypt
      ?.encrypted_key
  } catch {
    return undefined
  }
  if (!encryptedKey) return undefined

  const wrapped = Buffer.from(encryptedKey, "base64")
  if (wrapped.subarray(0, dpapiPrefix.length).toString("latin1") !== dpapiPrefix)
    return undefined
  return dpapiUnprotect(wrapped.subarray(dpapiPrefix.length))
}

// DPAPI has no Node binding, so the unprotect runs through PowerShell, which
// exposes the same CryptUnprotectData the browser used. Base64 crosses the
// process boundary in both directions so no bytes touch the command line as
// text or a temporary file.
function dpapiUnprotect(blob: Buffer): Buffer | undefined {
  const script = [
    "Add-Type -AssemblyName System.Security;",
    "$in=[Console]::In.ReadToEnd();",
    "$bytes=[Convert]::FromBase64String($in);",
    "$out=[System.Security.Cryptography.ProtectedData]::Unprotect(",
    "$bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);",
    "[Console]::Out.Write([Convert]::ToBase64String($out));",
  ].join("")
  try {
    const output = execFileSync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { input: blob.toString("base64"), encoding: "utf8" }
    )
    return Buffer.from(output.trim(), "base64")
  } catch {
    return undefined
  }
}

/**
 * Builds the crypto for one profile on the current platform. macOS and Linux
 * decrypt with AES-128-CBC; Windows with AES-256-GCM. Missing key material for
 * a version leaves that version undefined so its cookies are skipped rather
 * than corrupted.
 */
export function resolveCookieCrypto(
  env: DiscoveryEnvironment,
  profile: { safeStorageService: string; userDataDir: string }
): CookieCrypto {
  if (env.platform === "linux") {
    const v10 = deriveCbcKey(linuxDefaultPassword, linuxIterations)
    const keyringPassword = linuxKeyringPassword(profile.safeStorageService)
    const v11 = keyringPassword
      ? deriveCbcKey(keyringPassword, linuxIterations)
      : undefined
    return {
      scheme: "cbc",
      keyForVersion: (version) => (version === "v10" ? v10 : v11),
    }
  }

  if (env.platform === "darwin") {
    const password = keychainPassword(profile.safeStorageService)
    const key = password ? deriveCbcKey(password, macIterations) : undefined
    return { scheme: "cbc", keyForVersion: () => key }
  }

  const master = windowsMasterKey(profile.userDataDir)
  return { scheme: "gcm", keyForVersion: () => master }
}
