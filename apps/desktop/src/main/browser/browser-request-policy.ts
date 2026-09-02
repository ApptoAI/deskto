import { browserHostAllowed } from "@deskto/settings"

/**
 * Every URL scheme the host rules govern. Anything else (`about:blank`,
 * `data:`, `blob:`, the private Artifact protocol) carries no third-party
 * host and stays outside the rules, as ADR 0031 promised.
 */
const governedProtocols = new Set(["http:", "https:", "ws:", "wss:"])

/** The request filter that hands the session listener every governed URL. */
export const browserRequestFilter = {
  urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"],
}

export type BrowserHostRules = {
  allow: readonly string[]
  deny: readonly string[]
}

/**
 * Whether a request for this URL may leave the task browser under the
 * person's host rules. Reads the rules on every call so a settings change
 * applies to the next request without re-registering listeners.
 */
export function isBrowserRequestPermitted(
  value: string,
  rules: BrowserHostRules
): boolean {
  try {
    const url = new URL(value)
    if (!governedProtocols.has(url.protocol)) return true
    return browserHostAllowed(url.hostname, rules)
  } catch {
    return false
  }
}

/** The slice of Electron's `Session.webRequest` the policy touches. */
export type BrowserRequestSession = {
  webRequest: {
    onBeforeRequest(
      filter: { urls: string[] },
      listener: (
        details: { url: string; resourceType: string },
        callback: (response: { cancel?: boolean }) => void
      ) => void
    ): void
  }
}

/** The slice of Electron's `WebContents` the frame policy touches. */
export type BrowserFrameNavigationTarget = {
  on(
    event: "will-frame-navigate",
    listener: (details: {
      url: string
      isMainFrame: boolean
      preventDefault(): void
    }) => void
  ): void
}

/**
 * Cancels every governed request a session makes to a blocked host, whatever
 * fetched it: a frame, an image, a script, a fetch, a WebSocket, or the hop
 * after a redirect. Chromium sends a redirect target through this listener
 * as a fresh request, so a redirect from an allowed page to a blocked host is
 * cancelled here even when it happens inside a frame that will-redirect never
 * reports. Only one listener can hold a session's `onBeforeRequest`; the
 * browser owns it.
 */
export function enforceBrowserHostRulesOnRequests(
  browserSession: BrowserRequestSession,
  rules: () => BrowserHostRules
): void {
  browserSession.webRequest.onBeforeRequest(
    browserRequestFilter,
    (details, callback) => {
      callback({ cancel: !isBrowserRequestPermitted(details.url, rules()) })
    }
  )
}

/**
 * Prevents a child frame from navigating to a blocked host, which covers
 * iframes and form targets. The main frame keeps its own will-navigate
 * checks, which also weigh the Artifact boundary, so this listener leaves
 * main-frame navigations alone rather than deciding them twice.
 */
export function enforceBrowserHostRulesOnFrames(
  webContents: BrowserFrameNavigationTarget,
  rules: () => BrowserHostRules
): void {
  webContents.on("will-frame-navigate", (details) => {
    if (details.isMainFrame) return
    if (!isBrowserRequestPermitted(details.url, rules())) {
      details.preventDefault()
    }
  })
}
