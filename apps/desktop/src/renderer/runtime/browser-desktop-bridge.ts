import {
  runtimeEventSchema,
  type RuntimeEvent,
  type RuntimeMethod,
  type RequestFor,
  type RuntimeResponse,
} from "@deskto/protocol"

import type { DesktopApi } from "../../shared/desktop-api.js"

/**
 * Dev-only stand-in for the preload bridge when the Surface runs in a plain
 * browser tab: requests go to the main process's HTTP bridge, events arrive
 * over Server-Sent Events. Desktop-only actions (file pickers, updates, the
 * in-window browser) resolve harmlessly because a browser tab cannot perform
 * them.
 */
export function createBrowserDesktopBridge(): DesktopApi {
  // Same-origin on purpose: the vite dev server proxies /bridge to the main
  // process, because an https-hosted Surface cannot fetch the bridge's plain
  // http port directly.
  const eventListeners = new Set<(event: RuntimeEvent) => void>()
  let eventSource: EventSource | undefined

  function connectEvents() {
    if (eventSource) return
    eventSource = new EventSource("/bridge/events")
    eventSource.onmessage = (message) => {
      let data: unknown
      try {
        data = JSON.parse(message.data)
      } catch {
        return
      }
      const parsed = runtimeEventSchema.safeParse(data)
      if (!parsed.success) {
        console.error(
          "Browser Surface received an invalid Runtime event",
          parsed.error
        )
        return
      }
      for (const listener of eventListeners) listener(parsed.data)
    }
  }

  return {
    devFlags: { forceOnboarding: false, elementPicker: false },
    platform: "linux",
    frostedShell: false,
    setNativeTheme: () => undefined,
    runtime: {
      request<M extends RuntimeMethod>(
        request: RequestFor<M>
      ): Promise<RuntimeResponse<M>> {
        // SAFETY: the bridge validates every request against
        // runtimeRequestSchema and answers with Runtime.request's own
        // response, which is the protocol's response for that method.
        return fetch("/bridge/request", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        }).then((response) => response.json() as Promise<RuntimeResponse<M>>)
      },
      subscribe(listener: (event: RuntimeEvent) => void): () => void {
        eventListeners.add(listener)
        connectEvents()
        return () => {
          eventListeners.delete(listener)
        }
      },
    },
    updates: {
      state: () =>
        Promise.resolve({
          currentVersion: "browser-dev",
          status: "unavailable" as const,
          message: "Updates live in the desktop app.",
        }),
      check: () => Promise.resolve(),
      install: () => Promise.resolve(),
      subscribe: () => () => {},
    },
    pickProject: () => Promise.resolve(undefined),
    pickPack: () => Promise.resolve(undefined),
    pickPackArchive: () => Promise.resolve(undefined),
    openExternal: (url) => {
      window.open(url, "_blank", "noopener")
      return Promise.resolve()
    },
    openFolder: () => Promise.resolve(),
    openFile: () => Promise.resolve(),
    revealFile: () => Promise.resolve(),
    saveFileCopy: () => Promise.resolve(false),
    browser: {
      show: () => Promise.reject(browserUnsupported()),
      hide: () => Promise.resolve(),
      state: () => Promise.reject(browserUnsupported()),
      navigate: () => Promise.reject(browserUnsupported()),
      action: () => Promise.reject(browserUnsupported()),
      openArtifact: () => Promise.reject(browserUnsupported()),
      selectElement: () => Promise.resolve(undefined),
      cancelElementSelection: () => Promise.resolve(),
      subscribe: () => () => {},
      profiles: () => Promise.resolve([]),
      clearProfile: () => Promise.reject(browserUnsupported()),
      openProfileFolder: () => Promise.reject(browserUnsupported()),
    },
    cookieImport: {
      discover: () => Promise.resolve([]),
      run: () =>
        Promise.resolve({
          imported: 0,
          skipped: 0,
          error: "Cookie import needs the desktop app.",
        }),
    },
  }
}

function browserUnsupported(): Error {
  return new Error("The embedded browser needs the desktop app.")
}
