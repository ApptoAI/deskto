import { describe, expect, it } from "vitest"

import {
  browserRequestFilter,
  enforceBrowserHostRulesOnFrames,
  enforceBrowserHostRulesOnRequests,
  isBrowserRequestPermitted,
  type BrowserFrameNavigationTarget,
  type BrowserHostRules,
  type BrowserRequestSession,
} from "./browser-request-policy.js"

type RequestListener = Parameters<
  BrowserRequestSession["webRequest"]["onBeforeRequest"]
>[1]
type FrameListener = Parameters<BrowserFrameNavigationTarget["on"]>[1]

function fakeSession() {
  let listener: RequestListener | undefined
  let filter: { urls: string[] } | undefined
  const browserSession: BrowserRequestSession = {
    webRequest: {
      onBeforeRequest(nextFilter, nextListener) {
        filter = nextFilter
        listener = nextListener
      },
    },
  }
  const request = (url: string, resourceType: string) => {
    let cancelled: boolean | undefined
    listener?.({ url, resourceType }, (response) => {
      cancelled = response.cancel
    })
    return cancelled
  }
  return { browserSession, request, filter: () => filter }
}

function fakeWebContents() {
  let listener: FrameListener | undefined
  const webContents: BrowserFrameNavigationTarget = {
    on(_event, nextListener) {
      listener = nextListener
      return webContents
    },
  }
  const navigate = (url: string, isMainFrame: boolean) => {
    let prevented = false
    listener?.({
      url,
      isMainFrame,
      preventDefault: () => {
        prevented = true
      },
    })
    return prevented
  }
  return { webContents, navigate }
}

const blockTracker: BrowserHostRules = {
  allow: [],
  deny: ["tracker.example"],
}
const allowOnlyCrm: BrowserHostRules = {
  allow: ["*.crm.example"],
  deny: [],
}

describe("browser request permission", () => {
  it("applies the host rules to web and socket URLs only", () => {
    expect(
      isBrowserRequestPermitted("https://tracker.example/pixel", blockTracker)
    ).toBe(false)
    expect(
      isBrowserRequestPermitted("wss://tracker.example/live", blockTracker)
    ).toBe(false)
    expect(
      isBrowserRequestPermitted("https://shop.example/", blockTracker)
    ).toBe(true)
    expect(isBrowserRequestPermitted("about:blank", allowOnlyCrm)).toBe(true)
    expect(
      isBrowserRequestPermitted("deskto-artifact://key/index.html", allowOnlyCrm)
    ).toBe(true)
    expect(isBrowserRequestPermitted("not a url", { allow: [], deny: [] })).toBe(
      false
    )
  })
})

describe("session request policy", () => {
  it("listens for every governed scheme", () => {
    const { browserSession, filter } = fakeSession()
    enforceBrowserHostRulesOnRequests(browserSession, () => blockTracker)
    expect(filter()).toEqual(browserRequestFilter)
    expect(browserRequestFilter.urls).toEqual([
      "http://*/*",
      "https://*/*",
      "ws://*/*",
      "wss://*/*",
    ])
  })

  it("cancels an iframe, image, fetch, and WebSocket to a blocked host", () => {
    const { browserSession, request } = fakeSession()
    enforceBrowserHostRulesOnRequests(browserSession, () => blockTracker)
    expect(request("https://tracker.example/frame", "subFrame")).toBe(true)
    expect(request("https://tracker.example/pixel.gif", "image")).toBe(true)
    expect(request("https://tracker.example/api", "xhr")).toBe(true)
    expect(request("wss://tracker.example/socket", "webSocket")).toBe(true)
  })

  it("lets the allowed page load its own resources", () => {
    const { browserSession, request } = fakeSession()
    enforceBrowserHostRulesOnRequests(browserSession, () => allowOnlyCrm)
    expect(request("https://app.crm.example/", "mainFrame")).toBe(false)
    expect(request("https://app.crm.example/app.js", "script")).toBe(false)
    expect(request("https://cdn.crm.example/logo.png", "image")).toBe(false)
    expect(request("wss://live.crm.example/events", "webSocket")).toBe(false)
  })

  it("cancels a redirect hop that leaves the allowed hosts", () => {
    const { browserSession, request } = fakeSession()
    enforceBrowserHostRulesOnRequests(browserSession, () => allowOnlyCrm)
    expect(request("https://app.crm.example/login", "subFrame")).toBe(false)
    expect(request("https://sso.other.example/auth", "subFrame")).toBe(true)
    expect(request("https://sso.crm.example/auth", "subFrame")).toBe(false)
  })

  it("reads the current rules on every request", () => {
    let rules = blockTracker
    const { browserSession, request } = fakeSession()
    enforceBrowserHostRulesOnRequests(browserSession, () => rules)
    expect(request("https://shop.example/", "mainFrame")).toBe(false)
    rules = allowOnlyCrm
    expect(request("https://shop.example/", "mainFrame")).toBe(true)
  })
})

describe("frame navigation policy", () => {
  it("prevents an iframe or form target from reaching a blocked host", () => {
    const { webContents, navigate } = fakeWebContents()
    enforceBrowserHostRulesOnFrames(webContents, () => blockTracker)
    expect(navigate("https://tracker.example/embed", false)).toBe(true)
    expect(navigate("https://tracker.example/submit", false)).toBe(true)
    expect(navigate("https://shop.example/embed", false)).toBe(false)
  })

  it("leaves main-frame navigations to the existing checks", () => {
    const { webContents, navigate } = fakeWebContents()
    enforceBrowserHostRulesOnFrames(webContents, () => blockTracker)
    expect(navigate("https://tracker.example/", true)).toBe(false)
  })
})
