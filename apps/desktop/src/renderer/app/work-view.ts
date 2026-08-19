import type { SettingsPageId } from "../components/settings/settings-pages.js"
import type { SkillsFilter } from "../components/skills/skills-filters.js"

export type WorkView =
  // projectId is the project picked for this one task while the sidebar is in
  // all-projects scope; without it that scope asks before showing the composer.
  | { kind: "new-task"; projectId?: string }
  | { kind: "task"; threadId: string }
  | { kind: "skills"; filter: SkillsFilter }
  | { kind: "projects" }

export type MainView =
  | WorkView
  | { kind: "settings"; page: SettingsPageId; returnTo: WorkView }

/**
 * Sends the workbench to a blank task, including the view behind Settings.
 * A view already on the new-task screen is returned unchanged, so a repeat
 * New task is a no-op and an in-progress draft is never thrown away.
 */
export function toNewTask(current: MainView): MainView {
  if (current.kind === "new-task") return current
  return current.kind === "settings"
    ? { ...current, returnTo: { kind: "new-task" } }
    : { kind: "new-task" }
}

/** Project and workspace changes keep the inventory open for the new scope. */
export function afterScopeChange(current: MainView): MainView {
  if (current.kind === "skills" || current.kind === "projects") return current
  return toNewTask(current)
}
