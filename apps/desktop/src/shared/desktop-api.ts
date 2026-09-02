import type {
  BrowserElementContext,
  BrowserProfile,
  BrowserProfileClearResult,
  RequestFor,
  RuntimeEvent,
  RuntimeMethod,
  RuntimeResponse,
} from "@deskto/protocol"

export type PickedProject = {
  path: string
  name: string
}

/**
 * How a Surface names a result for a file action. The path stays in the
 * Runtime, so the renderer cannot ask the shell to touch an arbitrary file.
 */
export type ResultRef = {
  threadId: string
  artifactId: string
}

export type BrowserBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type BrowserViewState = {
  threadId: string
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  openRequested: boolean
  error?: string
}

export type BrowserEvent =
  | { type: "state"; state: BrowserViewState }
  | { type: "open-requested"; threadId: string }

export type BrowserAction = "back" | "forward" | "reload"

// Chromium-family browsers Deskto can read cookies from. The union is the
// source of truth for both the discovery code in main and the settings UI.
export const browserIds = [
  "chrome",
  "chromium",
  "brave",
  "edge",
  "vivaldi",
] as const

export type BrowserId = (typeof browserIds)[number]

/** One detected browser profile the person can import cookies from. */
export type DetectedBrowserProfile = {
  /** Stable across a session: `${browserId}:${profileDirectory}`. */
  id: string
  browserId: BrowserId
  browserLabel: string
  profileDirectory: string
  /** The browser's own display name for the profile, or its directory. */
  profileName: string
}

export type CookieImportRequest = {
  profileId: string
  /** The Workspace whose browser profile receives the cookies. */
  workspaceId: string
  /** Hosts the person chose; only cookies for these are imported. */
  hosts: string[]
}

/**
 * The outcome the settings UI shows. `error` carries a next step ("Close
 * Chrome and try again") when the run could not complete, never a decrypted
 * value or a cookie name.
 */
export type CookieImportResult = {
  imported: number
  /** Cookies this machine could not decrypt, so nothing was written for them. */
  skipped: number
  error?: string
}

type UpdateStateBase = {
  currentVersion: string
}

export type UpdateState = UpdateStateBase &
  (
    | { status: "unavailable"; message: string }
    | { status: "idle" }
    | { status: "checking" }
    | { status: "up-to-date" }
    | {
        status: "downloading"
        availableVersion: string
        percent?: number
      }
    | { status: "ready"; availableVersion: string }
    | { status: "error"; message: string }
  )

export interface DesktopApi {
  /** Development-only switches; every flag is false in a packaged build. */
  devFlags: {
    /** Show the first-run wizard on every launch, ignoring the saved answer. */
    forceOnboarding: boolean
    /**
     * Only `pnpm desktop:dev:picker` sets this; packaged builds strip the
     * variable in main, so the overlay cannot ship.
     */
    elementPicker: boolean
  }
  runtime: {
    request<M extends RuntimeMethod>(
      request: RequestFor<M>
    ): Promise<RuntimeResponse<M>>
    subscribe(listener: (event: RuntimeEvent) => void): () => void
  }
  updates: {
    state(): Promise<UpdateState>
    check(): Promise<void>
    install(): Promise<void>
    subscribe(listener: (state: UpdateState) => void): () => void
  }
  pickProject(): Promise<PickedProject | undefined>
  pickPack(): Promise<PickedProject | undefined>
  pickPackArchive(): Promise<PickedProject | undefined>
  openExternal(url: string): Promise<void>
  /** Reveals a project folder in the system file manager. */
  openFolder(path: string): Promise<void>
  /** Hands a result to the application that owns its format. */
  openFile(result: ResultRef): Promise<void>
  /** Selects a result in the system file manager. */
  revealFile(result: ResultRef): Promise<void>
  /** Saves a result somewhere else; false when the user cancelled. */
  saveFileCopy(result: ResultRef, suggestedName: string): Promise<boolean>
  browser: {
    show(threadId: string, bounds: BrowserBounds): Promise<BrowserViewState>
    hide(threadId: string): Promise<void>
    state(threadId: string): Promise<BrowserViewState>
    navigate(threadId: string, url: string): Promise<BrowserViewState>
    action(threadId: string, action: BrowserAction): Promise<BrowserViewState>
    openArtifact(result: ResultRef): Promise<BrowserViewState>
    selectElement(threadId: string): Promise<BrowserElementContext | undefined>
    cancelElementSelection(threadId: string): Promise<void>
    subscribe(listener: (event: BrowserEvent) => void): () => void
    /** One profile per Workspace, sized from disk on each call. */
    profiles(): Promise<BrowserProfile[]>
    /** Empties a Workspace's cookies, storage and logins; the folder stays. */
    clearProfile(workspaceId: string): Promise<BrowserProfileClearResult>
    /** Reveals the profile folder in the system file manager. */
    openProfileFolder(workspaceId: string): Promise<void>
  }
  cookieImport: {
    /** Lists browser profiles on this machine with a readable cookie store. */
    discover(): Promise<DetectedBrowserProfile[]>
    /** Imports the chosen profile's cookies for the chosen hosts. */
    run(request: CookieImportRequest): Promise<CookieImportResult>
  }
  platform: NodeJS.Platform
  /**
   * True when the window sits on the operating system's own blur (macOS
   * vibrancy, Windows acrylic) and the Surface should thin its shell to let
   * it through. False wherever the window is opaque.
   */
  frostedShell: boolean
  /**
   * Tells the window which palette the Surface chose, so the native blur
   * behind it and the frame it paints before the Surface loads match.
   */
  setNativeTheme(dark: boolean): void
  windowControls?: {
    minimize(): void
    toggleMaximize(): void
    close(): void
  }
}
