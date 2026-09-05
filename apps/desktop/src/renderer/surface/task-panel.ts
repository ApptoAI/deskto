import type { ResultRef } from "../../shared/desktop-api.js"

export type TaskPanelSurface = "files" | "activities" | "browser" | "side"

export type TaskPanelState = {
  readonly open: boolean
  readonly surface: TaskPanelSurface
  readonly selectedAgentId?: string
  readonly selectedArtifactId?: string
  /** The Project root is the empty string. */
  readonly folderPath: string
}

export type TaskPanelCapability = {
  state: (threadId: string) => TaskPanelState
  subscribe: (listener: () => void) => () => void
  open: (input: { threadId: string; surface?: TaskPanelSurface }) => void
  close: (threadId: string) => void
  toggle: (input: { threadId: string; surface?: TaskPanelSurface }) => void
}

const defaultState: TaskPanelState = {
  open: false,
  surface: "files",
  folderPath: "",
}

export class TaskPanelApi {
  readonly #byThread = new Map<string, TaskPanelState>()
  readonly #listeners = new Set<() => void>()

  state(threadId: string): TaskPanelState {
    return this.#byThread.get(threadId) ?? defaultState
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  open(input: { threadId: string; surface?: TaskPanelSurface }): void {
    const current = this.state(input.threadId)
    const surface = input.surface ?? current.surface
    if (current.open && current.surface === surface) return
    this.#update(input.threadId, { ...current, open: true, surface })
  }

  close(threadId: string): void {
    const current = this.state(threadId)
    if (!current.open) return
    this.#update(threadId, { ...current, open: false })
  }

  toggle(input: { threadId: string; surface?: TaskPanelSurface }): void {
    const current = this.state(input.threadId)
    if (current.open && (!input.surface || current.surface === input.surface)) {
      this.close(input.threadId)
      return
    }
    this.open(input)
  }

  showAgent(threadId: string, agentId: string | undefined): void {
    const current = { ...this.state(threadId) }
    if (agentId) current.selectedAgentId = agentId
    else delete current.selectedAgentId
    this.#update(threadId, {
      ...current,
      open: true,
      surface: "activities",
    })
  }

  showFolder(threadId: string, folderPath: string): void {
    const current = this.state(threadId)
    if (
      current.open &&
      current.surface === "files" &&
      !current.selectedArtifactId &&
      current.folderPath === folderPath
    )
      return
    this.#update(threadId, {
      open: true,
      surface: "files",
      folderPath,
    })
  }

  showFile(threadId: string, artifactId: string): void {
    const current = this.state(threadId)
    if (
      current.open &&
      current.surface === "files" &&
      current.selectedArtifactId === artifactId
    )
      return
    this.#update(threadId, {
      ...current,
      open: true,
      surface: "files",
      selectedArtifactId: artifactId,
    })
  }

  keepFolder(threadId: string, folderPath: string): void {
    const current = this.state(threadId)
    if (current.folderPath === folderPath) return
    this.#update(threadId, { ...current, folderPath })
  }

  retainSelectedFile(threadId: string, availableIds: readonly string[]): void {
    const current = this.state(threadId)
    if (
      !current.selectedArtifactId ||
      availableIds.includes(current.selectedArtifactId)
    )
      return
    const remaining = { ...current }
    delete remaining.selectedArtifactId
    this.#update(threadId, remaining)
  }

  #update(threadId: string, next: TaskPanelState): void {
    this.#byThread.set(threadId, next)
    for (const listener of this.#listeners) listener()
  }
}

export class FilesSurfaceApi {
  constructor(private readonly panel: TaskPanelApi) {}

  openPanel(threadId: string): void {
    this.panel.open({ threadId, surface: "files" })
  }

  overview(threadId: string): void {
    this.panel.showFolder(threadId, "")
  }

  openFolder(threadId: string, folderPath: string): void {
    this.panel.showFolder(threadId, folderPath)
  }

  open(threadId: string, artifactId: string): void {
    this.panel.showFile(threadId, artifactId)
  }

  keepFolder(threadId: string, folderPath: string): void {
    this.panel.keepFolder(threadId, folderPath)
  }

  retainAvailable(threadId: string, artifactIds: readonly string[]): void {
    this.panel.retainSelectedFile(threadId, artifactIds)
  }

  openExternally(result: ResultRef): Promise<void> {
    return window.deskto.openFile(result)
  }

  reveal(result: ResultRef): Promise<void> {
    return window.deskto.revealFile(result)
  }

  saveCopy(result: ResultRef, suggestedName: string): Promise<boolean> {
    return window.deskto.saveFileCopy(result, suggestedName)
  }
}

export class ActivitiesSurfaceApi {
  constructor(private readonly panel: TaskPanelApi) {}

  open(threadId: string): void {
    this.panel.showAgent(threadId, undefined)
  }

  preview(threadId: string, agentId: string): void {
    this.panel.showAgent(threadId, agentId)
  }
}

export class SideSurfaceApi {
  constructor(private readonly panel: TaskPanelApi) {}

  open(threadId: string): void {
    this.panel.open({ threadId, surface: "side" })
  }
}
