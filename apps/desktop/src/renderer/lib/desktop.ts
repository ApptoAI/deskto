/** Desktop-only capabilities, kept apart from the Runtime protocol. */
export function openExternal(url: string): void {
  void window.appto.openExternal(url)
}

export function pickProjectFolder() {
  return window.appto.pickProject()
}
