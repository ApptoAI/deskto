const storageKey = "deskto.shell.sidebar-open"

/**
 * Whether the task list is out. The sidebar is summoned from the titlebar
 * rather than being permanent chrome, so this is the window's own memory of a
 * choice the person made — it is not a Runtime setting and does not belong in
 * the settings registry, which is why it lives in storage alone.
 *
 * Open is the default: a first launch that hid the task list would hide the
 * control that brings it back behind an icon nobody has reason to press yet.
 */
export function readRememberedSidebarOpen(): boolean {
  try {
    const stored = window.localStorage.getItem(storageKey)
    return stored === null ? true : stored === "true"
  } catch {
    return true
  }
}

export function rememberSidebarOpen(open: boolean): void {
  try {
    window.localStorage.setItem(storageKey, String(open))
  } catch {
    // The window still honours the choice for this session; only the memory
    // of it across launches is lost.
  }
}
