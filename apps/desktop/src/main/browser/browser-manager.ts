import { randomUUID } from "node:crypto"

import {
  BrowserWindow,
  session,
  WebContentsView,
  type Rectangle,
  type WebContents,
} from "electron"
import type {
  BrowserAutomationHost,
  BrowserSnapshot,
  BrowserStatus,
} from "@deskto/runtime"
import { z } from "zod"

import type {
  BrowserEvent,
  BrowserViewState,
} from "../../shared/desktop-api.js"
import {
  browserDeleteRegistryScript,
  browserElementBoundsScript,
  browserSetValueScript,
  browserSnapshotScript,
} from "./browser-page-script.js"
import { isBrowserWebUrl, normalizeBrowserUrl } from "./browser-url.js"

const browserPartition = "persist:deskto-browser"
const browserAutomationWorldId = 1_001
const maximumScreenshotBytes = 8 * 1024 * 1024
const navigationTimeoutMs = 30_000
const backgroundBounds: Rectangle = {
  x: -10_000,
  y: 0,
  width: 1280,
  height: 800,
}
const rawBrowserSnapshotSchema = z.object({
  text: z.string(),
  elements: z.array(
    z.object({
      ref: z.string(),
      tag: z.string(),
      role: z.string().optional(),
      name: z.string(),
      value: z.string().optional(),
    })
  ),
})
const browserPointSchema = z.object({ x: z.number(), y: z.number() }).nullable()

type BrowserTab = {
  view: WebContentsView
  refs: Set<string>
  registryKey?: string
  error?: string
}

export class BrowserManager implements BrowserAutomationHost {
  readonly #tabs = new Map<string, BrowserTab>()
  readonly #openRequests = new Set<string>()
  readonly #browserSession = session.fromPartition(browserPartition)
  #visibleThreadId?: string
  #visibleBounds = backgroundBounds

  constructor(
    private readonly window: BrowserWindow,
    private readonly publish: (event: BrowserEvent) => void
  ) {
    this.#browserSession.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false)
    )
    this.#browserSession.setPermissionCheckHandler(() => false)
    this.#browserSession.on("will-download", (event) => event.preventDefault())
  }

  show(threadId: string, bounds: Rectangle): BrowserViewState {
    const tab = this.#ensureTab(threadId)
    this.#openRequests.delete(threadId)
    if (this.#visibleThreadId && this.#visibleThreadId !== threadId) {
      this.#tabs.get(this.#visibleThreadId)?.view.setBounds(backgroundBounds)
    }
    this.#visibleThreadId = threadId
    this.#visibleBounds = bounds
    tab.view.setBounds(this.#status(tab).url ? bounds : backgroundBounds)
    return this.#viewState(threadId, tab)
  }

  hide(threadId: string): void {
    if (this.#visibleThreadId !== threadId) return
    this.#tabs.get(threadId)?.view.setBounds(backgroundBounds)
    this.#visibleThreadId = undefined
  }

  state(threadId: string): BrowserViewState {
    const tab = this.#tabs.get(threadId)
    if (tab) return this.#viewState(threadId, tab)
    return {
      threadId,
      url: "",
      title: "",
      loading: false,
      canGoBack: false,
      canGoForward: false,
      openRequested: this.#openRequests.has(threadId),
    }
  }

  async userNavigate(
    threadId: string,
    value: string
  ): Promise<BrowserViewState> {
    await this.navigate(threadId, value)
    return this.state(threadId)
  }

  async status(threadId: string): Promise<BrowserStatus> {
    return this.#status(this.#ensureTab(threadId))
  }

  async open(threadId: string, url?: string): Promise<BrowserStatus> {
    this.#requestPanel(threadId)
    if (url) return this.navigate(threadId, url)
    return this.status(threadId)
  }

  async navigate(threadId: string, value: string): Promise<BrowserStatus> {
    this.#requestPanel(threadId)
    const tab = this.#ensureTab(threadId)
    tab.refs.clear()
    tab.registryKey = undefined
    tab.error = undefined
    await withNavigationTimeout(tab.view.webContents, () =>
      tab.view.webContents.loadURL(normalizeBrowserUrl(value))
    )
    return this.#status(tab)
  }

  async snapshot(threadId: string): Promise<BrowserSnapshot> {
    this.#requestPanel(threadId)
    const tab = this.#ensureTab(threadId)
    const snapshotId = randomUUID()
    const registryKey = `__deskto_browser_${snapshotId.replaceAll("-", "")}`
    const raw = rawBrowserSnapshotSchema.parse(
      await tab.view.webContents.executeJavaScriptInIsolatedWorld(
        browserAutomationWorldId,
        [{ code: browserSnapshotScript(registryKey, tab.registryKey) }],
        true
      )
    )
    tab.refs = new Set(raw.elements.map((element) => element.ref))
    tab.registryKey = registryKey
    return {
      ...this.#status(tab),
      snapshotId,
      text: raw.text,
      elements: raw.elements.map((element) => ({
        ref: element.ref,
        tag: element.tag,
        role: element.role,
        name: element.name,
        value: element.value,
      })),
    }
  }

  async click(threadId: string, ref: string): Promise<BrowserStatus> {
    this.#requestPanel(threadId)
    const tab = this.#ensureTab(threadId)
    const point = await this.#elementPoint(tab, ref)
    tab.view.webContents.sendInputEvent({
      type: "mouseDown",
      x: Math.round(point.x),
      y: Math.round(point.y),
      button: "left",
      clickCount: 1,
    })
    tab.view.webContents.sendInputEvent({
      type: "mouseUp",
      x: Math.round(point.x),
      y: Math.round(point.y),
      button: "left",
      clickCount: 1,
    })
    await settleInput()
    return this.#status(tab)
  }

  async type(
    threadId: string,
    ref: string,
    text: string,
    submit: boolean
  ): Promise<BrowserStatus> {
    this.#requestPanel(threadId)
    const tab = this.#ensureTab(threadId)
    const registryKey = this.#registry(tab, ref)
    const changed = z
      .literal(true)
      .safeParse(
        await tab.view.webContents.executeJavaScriptInIsolatedWorld(
          browserAutomationWorldId,
          [{ code: browserSetValueScript(registryKey, ref, text) }],
          true
        )
      )
    if (!changed.success) throw new Error(`Element ${ref} cannot receive text`)
    if (submit) await this.#sendKey(tab, "Enter")
    await settleInput()
    return this.#status(tab)
  }

  async keypress(threadId: string, key: string): Promise<BrowserStatus> {
    this.#requestPanel(threadId)
    if (!/^[A-Za-z0-9+_-]{1,40}$/.test(key)) {
      throw new Error(`Unsupported browser key: ${key}`)
    }
    const tab = this.#ensureTab(threadId)
    await this.#sendKey(tab, key)
    await settleInput()
    return this.#status(tab)
  }

  async back(threadId: string): Promise<BrowserStatus> {
    this.#requestPanel(threadId)
    const tab = this.#ensureTab(threadId)
    if (tab.view.webContents.navigationHistory.canGoBack()) {
      await waitForNavigation(tab.view.webContents, () =>
        tab.view.webContents.navigationHistory.goBack()
      )
    }
    return this.#status(tab)
  }

  async forward(threadId: string): Promise<BrowserStatus> {
    this.#requestPanel(threadId)
    const tab = this.#ensureTab(threadId)
    if (tab.view.webContents.navigationHistory.canGoForward()) {
      await waitForNavigation(tab.view.webContents, () =>
        tab.view.webContents.navigationHistory.goForward()
      )
    }
    return this.#status(tab)
  }

  async reload(threadId: string): Promise<BrowserStatus> {
    this.#requestPanel(threadId)
    const tab = this.#ensureTab(threadId)
    if (!this.#status(tab).url) return this.#status(tab)
    tab.refs.clear()
    await waitForNavigation(tab.view.webContents, () =>
      tab.view.webContents.reload()
    )
    return this.#status(tab)
  }

  async screenshot(threadId: string) {
    this.#requestPanel(threadId)
    const tab = this.#ensureTab(threadId)
    const image = await tab.view.webContents.capturePage()
    const png = image.toPNG()
    if (png.byteLength > maximumScreenshotBytes) {
      throw new Error("Browser screenshot exceeds the 8 MB limit")
    }
    return {
      status: this.#status(tab),
      data: png.toString("base64"),
      mimeType: "image/png" as const,
    }
  }

  closeThread(threadId: string): void {
    const tab = this.#tabs.get(threadId)
    if (!tab) return
    if (this.#visibleThreadId === threadId) this.#visibleThreadId = undefined
    this.#openRequests.delete(threadId)
    this.window.contentView.removeChildView(tab.view)
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
    this.#tabs.delete(threadId)
  }

  close(): void {
    for (const threadId of this.#tabs.keys()) this.closeThread(threadId)
  }

  #ensureTab(threadId: string): BrowserTab {
    const current = this.#tabs.get(threadId)
    if (current && !current.view.webContents.isDestroyed()) return current
    if (current) this.closeThread(threadId)
    const view = new WebContentsView({
      webPreferences: {
        partition: browserPartition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    })
    const tab: BrowserTab = { view, refs: new Set() }
    this.#tabs.set(threadId, tab)
    this.window.contentView.addChildView(view)
    view.setBounds(backgroundBounds)
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
    view.webContents.on("will-navigate", (event, url) => {
      if (!isBrowserWebUrl(url)) event.preventDefault()
    })
    view.webContents.on("will-redirect", (event, url) => {
      if (!isBrowserWebUrl(url)) event.preventDefault()
    })
    const publish = () => this.#publishState(threadId, tab)
    view.webContents.on(
      "did-start-navigation",
      (_event, _url, isInPlace, isMainFrame) => {
        if (isMainFrame) {
          tab.refs.clear()
          if (isInPlace && tab.registryKey) {
            void view.webContents
              .executeJavaScriptInIsolatedWorld(browserAutomationWorldId, [
                { code: browserDeleteRegistryScript(tab.registryKey) },
              ])
              .catch(() => undefined)
          }
          tab.registryKey = undefined
        }
      }
    )
    view.webContents.on("did-start-loading", publish)
    view.webContents.on("did-stop-loading", publish)
    view.webContents.on("did-finish-load", () => {
      tab.error = undefined
      publish()
    })
    view.webContents.on("did-navigate", publish)
    view.webContents.on("did-navigate-in-page", publish)
    view.webContents.on("page-title-updated", publish)
    view.webContents.on("render-process-gone", () => {
      if (this.#tabs.get(threadId) !== tab) return
      this.closeThread(threadId)
      this.publish({
        type: "state",
        state: {
          ...this.state(threadId),
          error: "The Browser page stopped responding.",
        },
      })
    })
    view.webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, _url, isMainFrame) => {
        if (isMainFrame && errorCode !== -3) tab.error = errorDescription
        publish()
      }
    )
    return tab
  }

  async #elementPoint(
    tab: BrowserTab,
    ref: string
  ): Promise<{ x: number; y: number }> {
    const registryKey = this.#registry(tab, ref)
    const value = browserPointSchema.parse(
      await tab.view.webContents.executeJavaScriptInIsolatedWorld(
        browserAutomationWorldId,
        [{ code: browserElementBoundsScript(registryKey, ref) }],
        true
      )
    )
    if (!value)
      throw new Error(
        `Element ${ref} is no longer available; take a new snapshot`
      )
    return value
  }

  #registry(tab: BrowserTab, ref: string): string {
    if (!tab.refs.has(ref) || !tab.registryKey) {
      throw new Error(`Unknown element ref ${ref}; take a new snapshot`)
    }
    return tab.registryKey
  }

  #sendKey(tab: BrowserTab, key: string): Promise<void> {
    tab.view.webContents.sendInputEvent({ type: "keyDown", keyCode: key })
    tab.view.webContents.sendInputEvent({ type: "keyUp", keyCode: key })
    return Promise.resolve()
  }

  #status(tab: BrowserTab): BrowserStatus {
    const url = tab.view.webContents.getURL()
    return {
      url: url === "about:blank" ? "" : url,
      title: tab.view.webContents.getTitle(),
      loading: tab.view.webContents.isLoading(),
      canGoBack: tab.view.webContents.navigationHistory.canGoBack(),
      canGoForward: tab.view.webContents.navigationHistory.canGoForward(),
    }
  }

  #viewState(threadId: string, tab: BrowserTab): BrowserViewState {
    const state = {
      threadId,
      ...this.#status(tab),
      openRequested: this.#openRequests.has(threadId),
    }
    return tab.error ? { ...state, error: tab.error } : state
  }

  #publishState(threadId: string, tab: BrowserTab): void {
    if (this.#tabs.get(threadId) !== tab || tab.view.webContents.isDestroyed())
      return
    if (this.#visibleThreadId === threadId) {
      tab.view.setBounds(
        this.#status(tab).url ? this.#visibleBounds : backgroundBounds
      )
    }
    this.publish({ type: "state", state: this.#viewState(threadId, tab) })
  }

  #requestPanel(threadId: string): void {
    if (this.#visibleThreadId === threadId) return
    this.#openRequests.add(threadId)
    this.publish({ type: "open-requested", threadId })
  }
}

function settleInput(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 120))
}

async function withNavigationTimeout<T>(
  webContents: WebContents,
  navigate: () => Promise<T>
): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      navigate(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error("Browser navigation timed out"))
          if (!webContents.isDestroyed()) webContents.stop()
        }, navigationTimeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function waitForNavigation(
  webContents: WebContents,
  navigate: () => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      webContents.removeListener("did-stop-loading", finish)
      webContents.removeListener("did-navigate-in-page", finish)
      webContents.removeListener("render-process-gone", crashed)
    }
    const finish = () => {
      cleanup()
      resolve()
    }
    const crashed = () => {
      cleanup()
      reject(new Error("The Browser page stopped responding"))
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error("Browser navigation timed out"))
      if (!webContents.isDestroyed()) webContents.stop()
    }, navigationTimeoutMs)
    webContents.once("did-stop-loading", finish)
    webContents.once("did-navigate-in-page", finish)
    webContents.once("render-process-gone", crashed)
    try {
      navigate()
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}
