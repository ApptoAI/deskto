import type { SettingsPageId } from "../components/settings/settings-pages.js"
import type { SkillsFilter } from "../components/skills/skills-filters.js"

export type WorkView =
  | { kind: "new-task" }
  | { kind: "task"; threadId: string }
  | { kind: "skills"; filter: SkillsFilter }
  | { kind: "projects" }

export type MainView =
  | WorkView
  | { kind: "settings"; page: SettingsPageId; returnTo: WorkView }

/** Sends the workbench to a blank task, including the view behind Settings. */
export function toNewTask(current: MainView): MainView {
  return current.kind === "settings"
    ? { ...current, returnTo: { kind: "new-task" } }
    : { kind: "new-task" }
}

/** Project and workspace changes keep the inventory open for the new scope. */
export function afterScopeChange(current: MainView): MainView {
  if (current.kind === "skills" || current.kind === "projects") return current
  return toNewTask(current)
}
