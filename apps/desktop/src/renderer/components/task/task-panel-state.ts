import { useSyncExternalStore } from "react"

export type PanelSurface = "files" | "activities" | "browser"

export type PanelState = {
  surface: PanelSurface
  selectedArtifactId?: string
}

const defaultState: PanelState = { surface: "files" }
const byThread = new Map<string, PanelState>()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function stateFor(threadId: string): PanelState {
  return byThread.get(threadId) ?? defaultState
}

function update(threadId: string, next: PanelState): void {
  byThread.set(threadId, next)
  for (const listener of listeners) listener()
}

/**
 * The task panel remembers its place for the current app session. Files are
 * selected inside the Files surface; producing another file never changes it.
 */
export function usePanelState(threadId: string): PanelState {
  return useSyncExternalStore(subscribe, () => stateFor(threadId))
}

export function selectFiles(threadId: string): void {
  const current = stateFor(threadId)
  if (current.surface === "files") return
  update(threadId, { ...current, surface: "files" })
}

export function showFilesOverview(threadId: string): void {
  const current = stateFor(threadId)
  if (current.surface === "files" && !current.selectedArtifactId) return
  update(threadId, { surface: "files" })
}

export function showFile(threadId: string, artifactId: string): void {
  const current = stateFor(threadId)
  if (current.surface === "files" && current.selectedArtifactId === artifactId)
    return
  update(threadId, { surface: "files", selectedArtifactId: artifactId })
}

export function showActivities(threadId: string): void {
  const current = stateFor(threadId)
  if (current.surface === "activities") return
  update(threadId, { ...current, surface: "activities" })
}

export function showBrowser(threadId: string): void {
  const current = stateFor(threadId)
  if (current.surface === "browser") return
  update(threadId, { ...current, surface: "browser" })
}

/** Clear only a selection whose file disappeared from the task. */
export function retainSelectedFile(
  threadId: string,
  availableIds: readonly string[]
): void {
  const current = stateFor(threadId)
  if (
    !current.selectedArtifactId ||
    availableIds.includes(current.selectedArtifactId)
  )
    return
  update(threadId, { surface: current.surface })
}
