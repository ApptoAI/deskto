import { useEffect, useSyncExternalStore } from "react"

/**
 * Which results a task has open in the side panel, and which one is in front.
 * The state lives outside React so closing the panel, switching to another
 * task, and coming back keeps the same tabs: a result the user opened is a
 * place they were working, not a transient selection.
 *
 * It is deliberately not persisted. Tabs describe the current sitting, and a
 * restored tab pointing at a file an agent has since deleted reads as a bug.
 */
export type ResultTabs = {
  open: string[]
  activeId: string | null
  /**
   * Whether the panel has already chosen a result for this task. Closing the
   * last tab has to stick: without this the opener would treat the empty
   * panel as a fresh one and put the newest result straight back.
   */
  opened: boolean
}

const noTabs: ResultTabs = { open: [], activeId: null, opened: false }
const byThread = new Map<string, ResultTabs>()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function update(threadId: string, next: ResultTabs): void {
  byThread.set(threadId, next)
  for (const listener of listeners) listener()
}

function tabsFor(threadId: string): ResultTabs {
  return byThread.get(threadId) ?? noTabs
}

export function useResultTabs(threadId: string): ResultTabs {
  return useSyncExternalStore(subscribe, () => tabsFor(threadId))
}

export function openResultTab(threadId: string, artifactId: string): void {
  const tabs = tabsFor(threadId)
  if (tabs.activeId === artifactId && tabs.opened) return
  update(threadId, {
    open: tabs.open.includes(artifactId)
      ? tabs.open
      : [...tabs.open, artifactId],
    activeId: artifactId,
    opened: true,
  })
}

export function closeResultTab(threadId: string, artifactId: string): void {
  const tabs = tabsFor(threadId)
  const index = tabs.open.indexOf(artifactId)
  if (index === -1) return
  const open = tabs.open.filter((id) => id !== artifactId)
  update(threadId, {
    ...tabs,
    open,
    // Closing the front tab falls back to its neighbour rather than the
    // first tab, so a run of closes walks the strip instead of jumping.
    activeId:
      tabs.activeId === artifactId
        ? (open[index] ?? open[index - 1] ?? null)
        : tabs.activeId,
  })
}

/**
 * Drops tabs whose result is gone from the task. Called with every refreshed
 * result list, so it must not signal a change when nothing moved.
 */
export function retainResultTabs(
  threadId: string,
  availableIds: readonly string[]
): void {
  const tabs = tabsFor(threadId)
  const available = new Set(availableIds)
  const open = tabs.open.filter((id) => available.has(id))
  if (open.length === tabs.open.length) return
  update(threadId, {
    ...tabs,
    open,
    activeId:
      tabs.activeId && available.has(tabs.activeId)
        ? tabs.activeId
        : (open[0] ?? null),
  })
}

/**
 * Opens the newest result the first time a task's panel has nothing in front,
 * so the Results button lands on a file rather than on an empty panel. It
 * fires once per task: after that an empty panel is the user's own doing.
 */
export function useOpenNewestResult(
  threadId: string,
  newestId: string | undefined,
  enabled: boolean
): void {
  const tabs = useResultTabs(threadId)
  const settled = tabs.opened
  useEffect(() => {
    if (!enabled || settled || !newestId) return
    openResultTab(threadId, newestId)
  }, [enabled, newestId, settled, threadId])
}
