import { useCallback, useState } from "react"
import { z } from "zod"

import type { ProjectPanelPreference } from "../components/task/new-task-view.js"
import { useLocalStorage } from "../lib/use-local-storage.js"

/** Projects whose panel the user explicitly collapsed (true) or opened. */
const panelCollapsedSchema = z.record(z.string(), z.boolean())

/**
 * Remembers, per project, whether the settings panel under the composer is
 * out. An explicit choice sticks across restarts; without one the panel
 * decides from how configured the project is ("auto"). The session-only
 * override forces it open for "Project settings"-style intents.
 */
export function useProjectPanel(activeProjectId: string | null) {
  const [collapsedMap, setCollapsedMap] = useLocalStorage<
    Record<string, boolean>
  >("deskto.project-panel.v1", {}, panelCollapsedSchema)
  const [overrideProjectId, setOverrideProjectId] = useState<string | null>(
    null
  )

  const stored = activeProjectId ? collapsedMap[activeProjectId] : undefined
  const preference: ProjectPanelPreference =
    activeProjectId && overrideProjectId === activeProjectId
      ? "open"
      : stored === undefined
        ? "auto"
        : stored
          ? "collapsed"
          : "open"

  const setCollapsed = useCallback(
    (collapsed: boolean) => {
      if (!activeProjectId) return
      setOverrideProjectId(null)
      setCollapsedMap((previous) => ({
        ...previous,
        [activeProjectId]: collapsed,
      }))
    },
    [activeProjectId, setCollapsedMap]
  )

  const forceOpen = useCallback(() => {
    if (activeProjectId) setOverrideProjectId(activeProjectId)
  }, [activeProjectId])

  return { preference, setCollapsed, forceOpen }
}
