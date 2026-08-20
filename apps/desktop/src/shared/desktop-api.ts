import type {
  BrowserElementContext,
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
  }
}
