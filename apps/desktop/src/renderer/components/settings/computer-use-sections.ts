import type { ComponentType } from "react"

import { BrowserSettingsSection } from "./computer-use-browser-section.js"
import { ScreenControlSettingsSection } from "./computer-use-screen-control-section.js"

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
    id: "screen-control",
    label: "Screen control",
    description:
      "Lets agents work the built-in browser the way a person does: look at it, then click, type, and scroll by position. Everything stays inside the task's browser; agents never reach other apps or your desktop.",
    Component: ScreenControlSettingsSection,
  },
]
