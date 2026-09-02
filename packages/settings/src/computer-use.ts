import { z } from "zod"

import { defineSetting } from "./definition.js"

/**
 * Settings for the built-in task browser and the computer-use features that
 * grow around it. Every key sits under `computerUse.` so a later section
 * (cookie import, per-workspace profiles, a computer-use MCP server) adds
 * keys beside these without a new namespace. See ADR 0030.
 */

export const maxBrowserUserAgentLength = 512

/** Empty means the browser identifies as the bundled Chromium. */
export const browserUserAgentSchema = z
  .string()
  .max(maxBrowserUserAgentLength)
  .refine((value) => !/[\r\n]/.test(value), {
    message: "A user agent is one line",
  })

export const minBrowserViewportSide = 320
export const maxBrowserViewportSide = 4_096

export const browserViewportSchema = z.object({
  width: z
    .number()
    .int()
    .min(minBrowserViewportSide)
    .max(maxBrowserViewportSide),
  height: z
    .number()
    .int()
    .min(minBrowserViewportSide)
    .max(maxBrowserViewportSide),
})

export type BrowserViewport = z.infer<typeof browserViewportSchema>

export const defaultBrowserViewport: BrowserViewport = {
  width: 1280,
  height: 800,
}

/**
 * One host rule: a bare host such as `example.com`, or `*.example.com` to
 * cover every subdomain as well as the host itself. No scheme, port, or path.
 */
const hostPattern = /^(\*\.)?(?:[a-z0-9-]+\.)*[a-z0-9-]+$|^\[[0-9a-f:.]+\]$/i

export const browserHostRuleSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .refine((value) => hostPattern.test(value), {
    message: "Use a host like example.com or *.example.com",
  })

export const maxBrowserHostRules = 200

export const browserHostRulesSchema = z
  .array(browserHostRuleSchema)
  .max(maxBrowserHostRules)

export function isBrowserHostRule(value: string): boolean {
  return browserHostRuleSchema.safeParse(value).success
}

/** Splits a person-typed list, one rule per line, keeping only non-empty lines. */
export function parseBrowserHostRules(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function matchesHostRule(host: string, rule: string): boolean {
  const normalizedRule = rule.toLowerCase()
  if (normalizedRule.startsWith("*.")) {
    const suffix = normalizedRule.slice(2)
    return host === suffix || host.endsWith(`.${suffix}`)
  }
  return host === normalizedRule
}

/**
 * Whether a host may be opened. A deny rule always wins. An empty allow list
 * permits every host not denied; a non-empty one permits only its matches.
 * `about:blank` and other non-web URLs are decided elsewhere; this only
 * answers for a host name.
 */
export function browserHostAllowed(
  host: string,
  rules: { allow: readonly string[]; deny: readonly string[] }
): boolean {
  const normalizedHost = host.toLowerCase().replace(/\.$/, "")
  if (!normalizedHost) return false
  if (rules.deny.some((rule) => matchesHostRule(normalizedHost, rule))) {
    return false
  }
  if (rules.allow.length === 0) return true
  return rules.allow.some((rule) => matchesHostRule(normalizedHost, rule))
}

/**
 * A folder name relative to the project root, forward slashes between
 * segments. Empty keeps downloads blocked, which is the browser's default.
 */
export const browserDownloadFolderSchema = z
  .string()
  .trim()
  .max(255)
  .refine((value) => isBrowserDownloadFolder(value), {
    message: "Use a folder inside the project, like downloads or files/web",
  })

export function isBrowserDownloadFolder(value: string): boolean {
  if (value === "") return true
  if (value.startsWith("/") || value.startsWith("\\")) return false
  if (/^[a-z]:/i.test(value)) return false
  return value
    .split(/[/\\]/)
    .every(
      (segment) =>
        segment.length > 0 &&
        segment !== "." &&
        segment !== ".." &&
        !/[\0<>:"|?*]/.test(segment)
    )
}

export const defaultBrowserDownloadFolder = "downloads"

export const maxBrowserHomeUrlLength = 2_048

/** Empty means a task's browser starts blank. Only web pages qualify. */
export const browserHomeUrlSchema = z
  .string()
  .trim()
  .max(maxBrowserHomeUrlLength)
  .refine((value) => isBrowserHomeUrl(value), {
    message: "Use a full web address, like https://example.com",
  })

export function isBrowserHomeUrl(value: string): boolean {
  if (value === "") return true
  try {
    const protocol = new URL(value).protocol
    return protocol === "http:" || protocol === "https:"
  } catch {
    return false
  }
}

export const computerUseSettings = {
  browserUserAgent: defineSetting({
    key: "computerUse.browser.user-agent",
    label: "User agent",
    description:
      "How the built-in browser introduces itself to websites. Leave empty to use the default.",
    input: { kind: "text", placeholder: "Default", monospace: true },
    schema: browserUserAgentSchema,
    defaultValue: "",
  }),
  browserViewport: defineSetting({
    key: "computerUse.browser.viewport",
    label: "Page size",
    description:
      "The width and height of the page while a task's browser is not on screen, which is also what agents see in screenshots.",
    input: { kind: "viewport" },
    schema: browserViewportSchema,
    defaultValue: defaultBrowserViewport,
  }),
  browserAllowedHosts: defineSetting({
    key: "computerUse.browser.allowed-hosts",
    label: "Only allow these sites",
    description:
      "One site per line. When the list is empty, every site is allowed unless it is blocked below.",
    input: { kind: "host-list" },
    schema: browserHostRulesSchema,
    defaultValue: [],
  }),
  browserBlockedHosts: defineSetting({
    key: "computerUse.browser.blocked-hosts",
    label: "Never open these sites",
    description:
      "One site per line. A blocked site stays blocked even when it is also allowed above.",
    input: { kind: "host-list" },
    schema: browserHostRulesSchema,
    defaultValue: [],
  }),
  browserClearSessionBetweenTasks: defineSetting({
    key: "computerUse.browser.clear-session-between-tasks",
    label: "Forget logins between tasks",
    description:
      "Give each task a fresh browser with no cookies or saved logins from other tasks.",
    input: { kind: "toggle" },
    schema: z.boolean(),
    defaultValue: false,
  }),
  browserDownloadFolder: defineSetting({
    key: "computerUse.browser.download-folder",
    label: "Download folder",
    description:
      "Where downloaded files go, inside the project. Leave empty to block downloads.",
    input: { kind: "text", placeholder: "Blocked", monospace: true },
    schema: browserDownloadFolderSchema,
    defaultValue: defaultBrowserDownloadFolder,
  }),
  browserHomeUrl: defineSetting({
    key: "computerUse.browser.home-url",
    label: "Start page",
    description:
      "The page a task's browser opens with. Leave empty to start blank.",
    input: { kind: "text", placeholder: "Blank page", monospace: true },
    schema: browserHomeUrlSchema,
    defaultValue: "",
  }),
  screenControlEnabled: defineSetting({
    key: "computerUse.screen-control.enabled",
    label: "Let agents use the screen",
    description:
      "Agents can look at the built-in browser and click, type, and scroll on it like a person would, instead of only reading the page. Turning this off applies to tasks started from now on.",
    input: { kind: "toggle" },
    schema: z.boolean(),
    defaultValue: true,
  }),
}
