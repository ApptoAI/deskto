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
import {
  browserElementContextSchema,
  browserElementSelectionSchema,
  type BrowserElementContext,
} from "@deskto/protocol"
import { z } from "zod"

import type {
  BrowserEvent,
  BrowserViewState,
} from "../../shared/desktop-api.js"
import { BrowserArtifactOpenRequests } from "./browser-artifact-open.js"
import {
  browserArtifactBoundaryAllowed,
  browserArtifactKey,
  browserArtifactKeysToEvict,
  browserArtifactKeyFromUrl,
  browserArtifactResponse,
  browserArtifactScheme,
  browserArtifactUrl,
  inactiveBrowserArtifactHistoryIndexes,
  isBrowserArtifactUrl,
  type BrowserArtifactInput,
  type BrowserArtifactResource,
} from "./browser-artifact.js"
import {
  sanitizeBrowserContextTitle,
  sanitizeBrowserContextUrl,
} from "./browser-context.js"
import {
  browserCancelElementPickerScript,
  browserDeleteRegistryScript,
  browserElementBoundsScript,
  browserElementPickerScript,
  browserSetValueScript,
  browserSnapshotScript,
} from "./browser-page-script.js"
import { isBrowserWebUrl, normalizeBrowserUrl } from "./browser-url.js"

const browserPartition = "persist:deskto-browser"
const browserAutomationWorldId = 1_001
const browserElementPickerControlKey = "__deskto_element_picker_control"
const maximumBrowserArtifactResources = 8
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
const rawBrowserElementContextSchema = browserElementSelectionSchema.nullable()

type BrowserTab = {
  view: WebContentsView
  refs: Set<string>
  registryKey?: string
  artifact?: {
    key: string
    url: string
    loadResource: () => Promise<BrowserArtifactInput>
  }
  restoringArtifact?: Promise<boolean>
  error?: string
  selectingElement?: boolean
  agentInput?: symbol
  artifactBoundaryNavigation?: {
    token: symbol
    expectedUrl: string
    started: boolean
  }
}

export class BrowserManager implements BrowserAutomationHost {
  readonly #tabs = new Map<string, BrowserTab>()
  readonly #artifactResources = new Map<string, BrowserArtifactResource>()
  readonly #artifactLoads = new Map<string, number>()
  readonly #artifactOpens = new BrowserArtifactOpenRequests()
  readonly #openRequests = new Set<string>()
  readonly #browserSession = session.fromPartition(browserPartition)
  #visibleThreadId?: string
  #visibleBounds = backgroundBounds

  constructor(
    private readonly window: BrowserWindow,
    private readonly publish: (event: BrowserEvent) => void
  ) {
    this.#browserSession.protocol.handle(browserArtifactScheme, (request) => {
      const key = browserArtifactKeyFromUrl(request.url)
      return browserArtifactResponse(
        request,
        key ? this.#artifactResources.get(key) : undefined
      )
    })
    this.#browserSession.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false)
    )
    this.#browserSession.setPermissionCheckHandler(() => false)
    this.#browserSession.on("will-download", (event) => event.preventDefault())
  }

  async show(threadId: string, bounds: Rectangle): Promise<BrowserViewState> {
    const tab = this.#ensureTab(threadId)
    this.#openRequests.delete(threadId)
    if (this.#visibleThreadId && this.#visibleThreadId !== threadId) {
      this.#tabs.get(this.#visibleThreadId)?.view.setBounds(backgroundBounds)
    }
    this.#visibleThreadId = threadId
    this.#visibleBounds = bounds
    await this.#restoreArtifact(threadId, tab)
    if (
      this.#visibleThreadId !== threadId ||
      this.#tabs.get(threadId) !== tab
    ) {
      return this.state(threadId)
    }
    tab.view.setBounds(this.#status(tab).url ? bounds : backgroundBounds)
    return this.#viewState(threadId, tab)
  }

  hide(threadId: string): void {
    this.#artifactOpens.invalidate(threadId)
    if (this.#visibleThreadId !== threadId) return
    this.#tabs.get(threadId)?.view.setBounds(backgroundBounds)
    this.#visibleThreadId = undefined
    this.#pruneArtifactResources()
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
    const trimmedValue = value.trim()
    const currentState = this.state(threadId)
    if (
      isBrowserArtifactUrl(trimmedValue) &&
      currentState.url === trimmedValue
    ) {
      return currentState
    }
    await this.navigate(threadId, value)
    return this.state(threadId)
  }

  async openArtifact(
    threadId: string,
    loadResource: () => Promise<BrowserArtifactInput>
  ): Promise<BrowserViewState> {
    const request = this.#artifactOpens.begin(threadId)
    try {
      const resource = await loadResource()
      if (!this.#artifactOpens.isCurrent(request)) return this.state(threadId)
      this.#requestPanel(threadId)
      const tab = this.#ensureTab(threadId)
      await this.#cancelElementPicker(tab)
      if (!this.#artifactOpens.isCurrent(request)) return this.state(threadId)
      const artifact = { ...resource, threadId }
      const artifactKey = browserArtifactKey(artifact)
      this.#artifactResources.delete(artifactKey)
      this.#artifactResources.set(artifactKey, artifact)
      const artifactUrl = browserArtifactUrl(artifact)
      const artifactState = {
        key: artifactKey,
        url: artifactUrl,
        loadResource,
      }
      tab.artifact = artifactState
      this.#retainArtifactLoad(artifactKey)
      tab.refs.clear()
      tab.registryKey = undefined
      tab.error = undefined
      try {
        await this.#runMainNavigation(tab, artifactUrl, () =>
          withNavigationTimeout(tab.view.webContents, () =>
            tab.view.webContents.loadURL(artifactUrl)
          )
        )
      } catch (error) {
        if (
          this.#artifactOpens.isCurrent(request) &&
          tab.artifact === artifactState
        ) {
          tab.artifact = undefined
        }
        throw error
      } finally {
        this.#releaseArtifactLoad(artifactKey)
        this.#pruneArtifactResources()
      }
      return this.#viewState(threadId, tab)
    } catch (error) {
      if (!this.#artifactOpens.isCurrent(request)) return this.state(threadId)
      throw error
    } finally {
      this.#artifactOpens.finish(request)
    }
  }

  async selectElement(
    threadId: string
  ): Promise<BrowserElementContext | undefined> {
    const tab = this.#ensureTab(threadId)
    this.#artifactOpens.invalidate(threadId)
    const status = this.#status(tab)
    if (!status.url) throw new Error("Open a page before selecting an element.")
    if (tab.selectingElement) {
      throw new Error("An element selection is already active.")
    }
    if (tab.agentInput) {
      throw new Error("The agent is operating the page; try again shortly.")
    }

    tab.selectingElement = true
    try {
      const raw = rawBrowserElementContextSchema.parse(
        await tab.view.webContents.executeJavaScriptInIsolatedWorld(
          browserAutomationWorldId,
          [
            {
              code: browserElementPickerScript(browserElementPickerControlKey),
            },
          ],
          true
        )
      )
      if (!raw) return undefined
      const current = this.#status(tab)
      return browserElementContextSchema.parse({
        id: randomUUID(),
        source: {
          url: sanitizeBrowserContextUrl(current.url),
          title: sanitizeBrowserContextTitle(current.title),
        },
        ...raw,
        capturedAt: new Date().toISOString(),
      })
    } finally {
      tab.selectingElement = false
    }
  }

  async cancelElementSelection(threadId: string): Promise<void> {
    const tab = this.#tabs.get(threadId)
    if (!tab?.selectingElement || tab.view.webContents.isDestroyed()) return
    await tab.view.webContents.executeJavaScriptInIsolatedWorld(
      browserAutomationWorldId,
      [
        {
          code: browserCancelElementPickerScript(
            browserElementPickerControlKey
          ),
        },
      ],
      true
    )
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
    this.#artifactOpens.invalidate(threadId)
    this.#requestPanel(threadId)
    const tab = this.#ensureTab(threadId)
    await this.#cancelElementPicker(tab)
    tab.refs.clear()
    tab.registryKey = undefined
    tab.error = undefined
    const url = normalizeBrowserUrl(value)
    await this.#runMainNavigation(tab, url, () =>
      withNavigationTimeout(tab.view.webContents, () =>
        tab.view.webContents.loadURL(url)
      )
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
    this.#artifactOpens.invalidate(threadId)
    this.#requestPanel(threadId)
    const tab = this.#ensureTab(threadId)
    return this.#withAgentInput(tab, async () => {
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
    })
  }

  async type(
    threadId: string,
    ref: string,
    text: string,
    submit: boolean
  ): Promise<BrowserStatus> {
    this.#artifactOpens.invalidate(threadId)
    this.#requestPanel(threadId)
    const tab = this.#ensureTab(threadId)
    return this.#withAgentInput(tab, async () => {
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
      if (!changed.success)
        throw new Error(`Element ${ref} cannot receive text`)
      if (submit) await this.#sendKey(tab, "Enter")
      await settleInput()
      return this.#status(tab)
    })
  }

  async keypress(threadId: string, key: string): Promise<BrowserStatus> {
    this.#artifactOpens.invalidate(threadId)
    this.#requestPanel(threadId)
    if (!/^[A-Za-z0-9+_-]{1,40}$/.test(key)) {
      throw new Error(`Unsupported browser key: ${key}`)
    }
    const tab = this.#ensureTab(threadId)
    return this.#withAgentInput(tab, async () => {
      await this.#sendKey(tab, key)
      await settleInput()
      return this.#status(tab)
    })
  }

  async back(threadId: string): Promise<BrowserStatus> {
    this.#artifactOpens.invalidate(threadId)
    this.#requestPanel(threadId)
    const tab = this.#ensureTab(threadId)
    await this.#cancelElementPicker(tab)
    const history = tab.view.webContents.navigationHistory
    if (history.canGoBack()) {
      const targetUrl = history.getEntryAtIndex(
        history.getActiveIndex() - 1
      ).url
      await this.#runMainNavigation(tab, targetUrl, () =>
        waitForNavigation(tab.view.webContents, () => history.goBack())
      )
    }
    return this.#status(tab)
  }

  async forward(threadId: string): Promise<BrowserStatus> {
    this.#artifactOpens.invalidate(threadId)
    this.#requestPanel(threadId)
    const tab = this.#ensureTab(threadId)
    await this.#cancelElementPicker(tab)
    const history = tab.view.webContents.navigationHistory
    if (history.canGoForward()) {
      const targetUrl = history.getEntryAtIndex(
        history.getActiveIndex() + 1
      ).url
      await this.#runMainNavigation(tab, targetUrl, () =>
        waitForNavigation(tab.view.webContents, () => history.goForward())
      )
    }
    return this.#status(tab)
  }

  async reload(threadId: string): Promise<BrowserStatus> {
    this.#artifactOpens.invalidate(threadId)
    this.#requestPanel(threadId)
    const tab = this.#ensureTab(threadId)
    await this.#cancelElementPicker(tab)
    const currentUrl = this.#status(tab).url
    if (!currentUrl) return this.#status(tab)
    tab.refs.clear()
    await this.#runMainNavigation(tab, currentUrl, () =>
      waitForNavigation(tab.view.webContents, () =>
        tab.view.webContents.reload()
      )
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
    this.#artifactOpens.clear(threadId)
    const tab = this.#tabs.get(threadId)
    if (!tab) return
    if (this.#visibleThreadId === threadId) this.#visibleThreadId = undefined
    this.#openRequests.delete(threadId)
    for (const [key, resource] of this.#artifactResources) {
      if (resource.threadId === threadId) this.#artifactResources.delete(key)
    }
    this.window.contentView.removeChildView(tab.view)
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
    this.#tabs.delete(threadId)
  }

  close(): void {
    for (const threadId of this.#tabs.keys()) this.closeThread(threadId)
    this.#browserSession.protocol.unhandle(browserArtifactScheme)
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
      if (!this.#navigationAllowed(tab, url)) {
        event.preventDefault()
      }
    })
    view.webContents.on("will-redirect", (event, url) => {
      const navigation = tab.artifactBoundaryNavigation
      if (navigation?.started) navigation.expectedUrl = url
      if (!this.#navigationAllowed(tab, url)) {
        event.preventDefault()
      }
    })
    const publish = () => this.#publishState(threadId, tab)
    view.webContents.on(
      "did-start-navigation",
      (_event, url, isInPlace, isMainFrame) => {
        if (isMainFrame) {
          const navigation = tab.artifactBoundaryNavigation
          if (
            navigation &&
            !navigation.started &&
            navigation.expectedUrl === url
          ) {
            navigation.started = true
          }
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
    const publishNavigation = (url: string) => {
      const navigation = tab.artifactBoundaryNavigation
      if (navigation?.started && navigation.expectedUrl === url) {
        tab.artifactBoundaryNavigation = undefined
      }
      const artifactKey = browserArtifactKeyFromUrl(url)
      if (artifactKey !== tab.artifact?.key) tab.artifact = undefined
      this.#pruneArtifactResources()
      publish()
    }
    view.webContents.on("did-navigate", (_event, url) => publishNavigation(url))
    view.webContents.on("did-navigate-in-page", () => {
      this.#pruneArtifactResources()
      publish()
    })
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
        if (isMainFrame) {
          if (errorCode !== -3) tab.error = errorDescription
        }
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

  async #cancelElementPicker(tab: BrowserTab): Promise<void> {
    if (!tab.selectingElement || tab.view.webContents.isDestroyed()) return
    await tab.view.webContents
      .executeJavaScriptInIsolatedWorld(
        browserAutomationWorldId,
        [
          {
            code: browserCancelElementPickerScript(
              browserElementPickerControlKey
            ),
          },
        ],
        true
      )
      .catch(() => undefined)
  }

  async #withAgentInput<T>(tab: BrowserTab, run: () => Promise<T>): Promise<T> {
    if (tab.selectingElement) {
      throw new Error(
        "The person is selecting a page element; try again shortly"
      )
    }
    if (tab.agentInput) throw new Error("Another page input is still running")
    const lease = Symbol("browser-agent-input")
    tab.agentInput = lease
    try {
      return await run()
    } finally {
      if (tab.agentInput === lease) tab.agentInput = undefined
    }
  }

  #navigationAllowed(tab: BrowserTab, url: string): boolean {
    if (!isBrowserWebUrl(url) && !isBrowserArtifactUrl(url)) return false
    return browserArtifactBoundaryAllowed(
      tab.view.webContents.getURL(),
      url,
      !!tab.artifactBoundaryNavigation?.started
    )
  }

  async #runMainNavigation<T>(
    tab: BrowserTab,
    expectedUrl: string,
    navigate: () => Promise<T>
  ): Promise<T> {
    const token = Symbol("artifact-boundary-navigation")
    tab.artifactBoundaryNavigation = { token, expectedUrl, started: false }
    try {
      return await navigate()
    } finally {
      if (tab.artifactBoundaryNavigation?.token === token) {
        tab.artifactBoundaryNavigation = undefined
      }
    }
  }

  async #restoreArtifact(threadId: string, tab: BrowserTab): Promise<boolean> {
    const artifactState = tab.artifact
    if (!artifactState || this.#artifactResources.has(artifactState.key)) {
      return false
    }
    if (tab.restoringArtifact) return tab.restoringArtifact

    const restore = (async () => {
      let resource: BrowserArtifactInput
      try {
        resource = await artifactState.loadResource()
      } catch (error) {
        if (
          this.#visibleThreadId !== threadId ||
          this.#tabs.get(threadId) !== tab ||
          tab.artifact !== artifactState
        ) {
          return false
        }
        throw error
      }
      if (
        this.#visibleThreadId !== threadId ||
        this.#tabs.get(threadId) !== tab ||
        tab.artifact !== artifactState
      ) {
        return false
      }

      const artifact = { ...resource, threadId }
      if (browserArtifactKey(artifact) !== artifactState.key) {
        throw new Error("The Artifact changed while its preview was restored.")
      }
      this.#retainArtifactLoad(artifactState.key)
      this.#artifactResources.delete(artifactState.key)
      this.#artifactResources.set(artifactState.key, artifact)
      tab.refs.clear()
      tab.registryKey = undefined
      tab.error = undefined
      try {
        await this.#runMainNavigation(tab, artifactState.url, () =>
          withNavigationTimeout(tab.view.webContents, () =>
            tab.view.webContents.loadURL(artifactState.url)
          )
        )
        return true
      } finally {
        this.#releaseArtifactLoad(artifactState.key)
        this.#pruneArtifactResources()
      }
    })()
    tab.restoringArtifact = restore
    try {
      return await restore
    } finally {
      if (tab.restoringArtifact === restore) tab.restoringArtifact = undefined
    }
  }

  #retainArtifactLoad(key: string): void {
    this.#artifactLoads.set(key, (this.#artifactLoads.get(key) ?? 0) + 1)
  }

  #releaseArtifactLoad(key: string): void {
    const count = this.#artifactLoads.get(key)
    if (!count || count === 1) {
      this.#artifactLoads.delete(key)
      return
    }
    this.#artifactLoads.set(key, count - 1)
  }

  #pruneArtifactResources(): void {
    const retainedKeys = new Set(this.#artifactLoads.keys())
    for (const [threadId, tab] of this.#tabs) {
      if (tab.view.webContents.isDestroyed()) continue
      const history = tab.view.webContents.navigationHistory
      const activeIndex = history.getActiveIndex()
      const entries = history.getAllEntries()
      for (const index of inactiveBrowserArtifactHistoryIndexes(
        entries,
        activeIndex
      )) {
        history.removeEntryAtIndex(index)
      }
      if (threadId === this.#visibleThreadId && tab.artifact) {
        retainedKeys.add(tab.artifact.key)
      }
    }
    for (const key of browserArtifactKeysToEvict(
      [...this.#artifactResources.keys()],
      retainedKeys,
      maximumBrowserArtifactResources
    )) {
      this.#artifactResources.delete(key)
    }
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
