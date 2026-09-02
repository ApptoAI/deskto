/** Desktop-only capabilities, kept apart from the Runtime protocol. */

export function openExternal(url: string): void {
  void window.deskto.openExternal(url)
}

export function openFolder(path: string): Promise<void> {
  return window.deskto.openFolder(path)
}

export function pickProjectFolder() {
  return window.deskto.pickProject()
}

export function pickPackFolder() {
  return window.deskto.pickPack()
}

export function pickPackArchive() {
  return window.deskto.pickPackArchive()
}

export function loadBrowserProfiles() {
  return window.deskto.browser.profiles()
}

export function clearBrowserProfile(workspaceId: string) {
  return window.deskto.browser.clearProfile(workspaceId)
}

export function openBrowserProfileFolder(workspaceId: string): Promise<void> {
  return window.deskto.browser.openProfileFolder(workspaceId)
}

export function discoverBrowserProfiles() {
  return window.deskto.cookieImport.discover()
}

export function importBrowserCookies(
  request: Parameters<typeof window.deskto.cookieImport.run>[0]
) {
  return window.deskto.cookieImport.run(request)
}
