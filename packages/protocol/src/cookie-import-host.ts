import { z } from "zod"

/**
 * A host the person may import cookies for. The import copies every cookie
 * that applies to the host into an agent-reachable Workspace profile, so a
 * public suffix such as "com" or "co.uk" would hand over cookies for every
 * site under it. The rule is therefore a registrable domain or something
 * below one: lowercase DNS labels, a letter in the top label, and at least
 * one label beyond the public suffix. Schemes, credentials, ports, paths and
 * wildcards are not hosts and are rejected outright; Surfaces that accept
 * URL-shaped input reduce it to a hostname before applying this rule.
 */

// The suffixes people are likely to type that the last-label rule alone would
// not catch. Two-letter country codes commonly register under a generic
// second label, and a few hosting providers hand out subdomains to strangers.
const secondLevelSuffixLabels = new Set([
  "ac",
  "co",
  "com",
  "edu",
  "gov",
  "mil",
  "net",
  "org",
  "ne",
  "or",
  "go",
  "nom",
  "ltd",
  "plc",
  "sch",
  "me",
  "biz",
  "info",
  "int",
])

const sharedHostingSuffixes = new Set([
  "github.io",
  "gitlab.io",
  "bitbucket.io",
  "herokuapp.com",
  "vercel.app",
  "netlify.app",
  "pages.dev",
  "workers.dev",
  "web.app",
  "firebaseapp.com",
  "appspot.com",
  "blogspot.com",
  "wordpress.com",
  "cloudfront.net",
  "amazonaws.com",
  "azurewebsites.net",
  "fly.dev",
  "ngrok.io",
  "repl.co",
  "glitch.me",
  "surge.sh",
  "onrender.com",
  "railway.app",
])

const labelPattern = /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/u
const maximumHostLength = 253

/** Trims, lowercases and drops leading dots; the shape browsers store. */
export function normalizeCookieImportHost(value: string): string {
  return value.trim().toLowerCase().replace(/^\.+/u, "")
}

function isPublicSuffix(labels: readonly string[]): boolean {
  if (labels.length <= 1) return true
  if (sharedHostingSuffixes.has(labels.join("."))) return true
  const [second, top] = labels.slice(-2)
  return (
    labels.length === 2 &&
    top !== undefined &&
    top.length === 2 &&
    second !== undefined &&
    secondLevelSuffixLabels.has(second)
  )
}

export function isCookieImportHost(value: string): boolean {
  const host = normalizeCookieImportHost(value)
  if (host.length === 0 || host.length > maximumHostLength) return false
  const labels = host.split(".")
  if (!labels.every((label) => labelPattern.test(label))) return false
  const top = labels.at(-1)
  if (top === undefined || !/[a-z]/u.test(top)) return false
  return !isPublicSuffix(labels)
}

export const cookieImportHostSchema = z
  .string()
  .refine(isCookieImportHost, { message: "Enter a website such as example.com" })
