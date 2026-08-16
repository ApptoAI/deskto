import { useEffect, useSyncExternalStore } from "react"

/**
 * The surface a task's side panel is on, and which results it has open. The
 * state lives outside React so closing the panel, switching to another task,
 * and coming back keeps the same tabs: a result the user opened is a place
 * they were working, not a transient selection.
 *
 * It is deliberately not persisted. Tabs describe the current sitting, and a
 * restored tab pointing at a file an agent has since deleted reads as a bug.
 */

/**
 * Activity is a fixture, not a tab the user opened: it is always first, never
 * closes, and is where the panel falls back when the last result closes. A
 * task always has work to show, even before it has produced a file.
 */
export const activityTabId = "activity"

export type PanelTabs = {
  /** Open results, in the order they were opened. Activity is not among them. */
  open: string[]
  activeId: string
  /**
   * Whether the panel has already chosen a surface for this task. Landing on
   * Activity has to stick: without this the opener would treat it as an
   * unclaimed panel and put the newest result in front of it.
   */
  opened: boolean
}

const noTabs: PanelTabs = { open: [], activeId: activityTabId, opened: false }
const byThread = new Map<string, PanelTabs>()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function update(threadId: string, next: PanelTabs): void {
  byThread.set(threadId, next)
  for (const listener of listeners) listener()
}

function tabsFor(threadId: string): PanelTabs {
  return byThread.get(threadId) ?? noTabs
}

export function usePanelTabs(threadId: string): PanelTabs {
  return useSyncExternalStore(subscribe, () => tabsFor(threadId))
}

export function openActivityTab(threadId: string): void {
  const tabs = tabsFor(threadId)
  if (tabs.activeId === activityTabId && tabs.opened) return
  update(threadId, { ...tabs, activeId: activityTabId, opened: true })
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
        ? (open[index] ?? open[index - 1] ?? activityTabId)
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
      tabs.activeId === activityTabId || available.has(tabs.activeId)
        ? tabs.activeId
        : (open[0] ?? activityTabId),
  })
}

/**
 * Opens the newest result the first time a task's panel has nothing in front,
 * so the Results button lands on a file rather than on the task's activity. It
 * fires once per task: after that the panel is wherever the user left it.
 */
export function useOpenNewestResult(
  threadId: string,
  newestId: string | undefined,
  enabled: boolean
): void {
  const tabs = usePanelTabs(threadId)
  const settled = tabs.opened
  useEffect(() => {
    if (!enabled || settled || !newestId) return
    openResultTab(threadId, newestId)
  }, [enabled, newestId, settled, threadId])
}
