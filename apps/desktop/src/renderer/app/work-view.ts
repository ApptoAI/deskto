import type { SettingsPageId } from "../components/settings/settings-pages.js"
import type { SkillsFilter } from "../components/skills/skills-filters.js"

export type WorkView =
  // The project's resting screen: its tasks, or the composer when it has
  // none. Separate from new-task because a project with work in it shows
  // that work, while New task still has to reach a blank composer.
  | { kind: "project" }
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

/**
 * Back to the project's own screen, including from behind Settings. Used
 * wherever a view stops being valid — the task was deleted, the workspace
 * went away — because a project always has a screen to fall back to.
 */
export function toProject(current: MainView): MainView {
  if (current.kind === "project") return current
  return current.kind === "settings"
    ? { ...current, returnTo: { kind: "project" } }
    : { kind: "project" }
}

/** Project and workspace changes keep the inventory open for the new scope. */
export function afterScopeChange(current: MainView): MainView {
  if (current.kind === "skills" || current.kind === "projects") return current
  // A half-typed task survives a scope change; everything else rests on the
  // project screen for the scope just chosen.
  if (current.kind === "new-task") return current
  return toProject(current)
}
