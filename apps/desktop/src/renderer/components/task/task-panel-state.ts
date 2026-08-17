import { useSyncExternalStore } from "react"

export type PanelSurface = "files" | "activities" | "browser"

export type PanelState = {
  surface: PanelSurface
  selectedArtifactId?: string
  /**
   * The folder the Files list stands in. The root of the Project is the empty
   * string — a real place the list can be, so it is a value rather than the
   * absence of one.
   */
  folderPath: string
}

const defaultState: PanelState = { surface: "files", folderPath: "" }
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

/** The whole of a task's files, from the top. */
export function showFilesOverview(threadId: string): void {
  showFolder(threadId, "")
}

/** One folder of a task's files, with nothing open inside it. */
export function showFolder(threadId: string, folderPath: string): void {
  const current = stateFor(threadId)
  if (
    current.surface === "files" &&
    !current.selectedArtifactId &&
    current.folderPath === folderPath
  )
    return
  update(threadId, { surface: "files", folderPath })
}

export function showFile(threadId: string, artifactId: string): void {
  const current = stateFor(threadId)
  if (current.surface === "files" && current.selectedArtifactId === artifactId)
    return
  update(threadId, {
    ...current,
    surface: "files",
    selectedArtifactId: artifactId,
  })
}

/**
 * Move the list to where the panel is standing without disturbing anything
 * open in it: the folder of the file being read, or the folder a vanished one
 * gave way to. Remembered rather than worked out again on each render — a
 * folder the task refills would otherwise pull the panel back down into it
 * with no click from the user.
 */
export function keepFolder(threadId: string, folderPath: string): void {
  const current = stateFor(threadId)
  if (current.folderPath === folderPath) return
  update(threadId, { ...current, folderPath })
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
  update(threadId, {
    surface: current.surface,
    folderPath: current.folderPath,
  })
}
