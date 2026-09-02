import { parse } from "tldts"
import { z } from "zod"

/**
 * A host the person may import cookies for. The import copies every cookie
 * that applies to the host into an agent-reachable Workspace profile, so a
 * public suffix such as "com", "co.uk" or "github.io" would hand over cookies
 * for every site under it. The rule is therefore a registrable domain or
 * something below one: lowercase DNS labels, a letter in the top label, and
 * at least one label beyond the public suffix as the Public Suffix List
 * defines it (tldts ships the list, private section included, and consults
 * nothing at runtime). Schemes, credentials, ports, paths and wildcards are
 * not hosts and are rejected outright; Surfaces that accept URL-shaped input
 * reduce it to a hostname before applying this rule.
 */

const labelPattern = /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/u
const maximumHostLength = 253

/** Trims, lowercases and drops leading dots; the shape browsers store. */
export function normalizeCookieImportHost(value: string): string {
  return value.trim().toLowerCase().replace(/^\.+/u, "")
}

export function isCookieImportHost(value: string): boolean {
  const host = normalizeCookieImportHost(value)
  if (host.length === 0 || host.length > maximumHostLength) return false
  const labels = host.split(".")
  if (!labels.every((label) => labelPattern.test(label))) return false
  const top = labels.at(-1)
  if (top === undefined || !/[a-z]/u.test(top)) return false
  // The private section makes shared hosts such as github.io a suffix, so
  // "foo.github.io" is a registrable domain and "github.io" itself is not.
  return parse(host, { allowPrivateDomains: true }).domain !== null
}

export const cookieImportHostSchema = z
  .string()
  .refine(isCookieImportHost, { message: "Enter a website such as example.com" })
