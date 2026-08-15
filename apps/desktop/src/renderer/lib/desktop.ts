/** Desktop-only capabilities, kept apart from the Runtime protocol. */
export function openExternal(url: string): void {
  void window.appto.openExternal(url)
}

export function openFolder(path: string): Promise<void> {
  return window.appto.openFolder(path)
}

export function pickProjectFolder() {
  return window.appto.pickProject()
}

export function pickPackFolder() {
  return window.appto.pickPack()
}
