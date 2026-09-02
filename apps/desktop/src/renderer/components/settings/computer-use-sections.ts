import type { ComponentType } from "react"

import { BrowserSettingsSection } from "./computer-use-browser-section.js"
import { BrowserProfilesSection } from "./computer-use-profiles-section.js"

/**
 * One block on the Computer use page. A new capability (cookie import,
 * per-workspace browser profiles, a computer-use MCP server) adds an entry
 * here and its settings under `computerUse.*` in `@deskto/settings`; the
 * page itself does not change.
 */
export type ComputerUseSection = {
  id: string
  label: string
  /** What the block controls, shown under its label. */
  description: string
  /** Renders the block's controls; it reads and writes settings itself. */
  Component: ComponentType
}

export const computerUseSections: readonly ComputerUseSection[] = [
  {
    id: "browser",
    label: "Built-in browser",
    description:
      "The browser agents use inside a task. Changes apply to pages opened from now on.",
    Component: BrowserSettingsSection,
  },
  {
    id: "profiles",
    label: "Browser profiles",
    description:
      "Each workspace keeps its own cookies, storage and logins. Deleting a workspace does not clear them, so clear them here first.",
    Component: BrowserProfilesSection,
  },
]
