import {
  defaultWorkspaceLayout,
  workspaceLayoutSchema,
  type WorkspaceLayout,
} from "@deskto/settings"

const storageKey = "deskto.appearance.workspace-layout"

export function parseRememberedWorkspaceLayout(
  value: string | null
): WorkspaceLayout {
  const parsed = workspaceLayoutSchema.safeParse(value)
  return parsed.success ? parsed.data : defaultWorkspaceLayout
}

export function readRememberedWorkspaceLayout(): WorkspaceLayout {
  try {
    return parseRememberedWorkspaceLayout(
      window.localStorage.getItem(storageKey)
    )
  } catch {
    return defaultWorkspaceLayout
  }
}

export function rememberWorkspaceLayout(layout: WorkspaceLayout): void {
  try {
    window.localStorage.setItem(storageKey, layout)
  } catch {
    // Runtime settings remain authoritative when storage is unavailable.
  }
}
