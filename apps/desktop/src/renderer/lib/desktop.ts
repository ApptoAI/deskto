/** Desktop-only capabilities, kept apart from the Runtime protocol. */
import type {
  BrowserAction,
  BrowserBounds,
  BrowserEvent,
  BrowserViewState,
  ResultRef,
} from "../../shared/desktop-api.js"

export function openExternal(url: string): void {
  void window.deskto.openExternal(url)
}

export function openFolder(path: string): Promise<void> {
  return window.deskto.openFolder(path)
}

export function openResultFile(result: ResultRef): Promise<void> {
  return window.deskto.openFile(result)
}

export function revealResultFile(result: ResultRef): Promise<void> {
  return window.deskto.revealFile(result)
}

export function saveResultCopy(
  result: ResultRef,
  suggestedName: string
): Promise<boolean> {
  return window.deskto.saveFileCopy(result, suggestedName)
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

export function showBrowser(
  threadId: string,
  bounds: BrowserBounds
): Promise<BrowserViewState> {
  return window.deskto.browser.show(threadId, bounds)
}

export function hideBrowser(threadId: string): Promise<void> {
  return window.deskto.browser.hide(threadId)
}

export function browserState(threadId: string): Promise<BrowserViewState> {
  return window.deskto.browser.state(threadId)
}

export function navigateBrowser(
  threadId: string,
  url: string
): Promise<BrowserViewState> {
  return window.deskto.browser.navigate(threadId, url)
}

export function runBrowserAction(
  threadId: string,
  action: BrowserAction
): Promise<BrowserViewState> {
  return window.deskto.browser.action(threadId, action)
}

export function subscribeBrowser(listener: (event: BrowserEvent) => void) {
  return window.deskto.browser.subscribe(listener)
}
