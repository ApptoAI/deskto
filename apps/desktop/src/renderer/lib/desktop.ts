/** Desktop-only capabilities, kept apart from the Runtime protocol. */
import type { ResultRef } from "../../shared/desktop-api.js"

export function openExternal(url: string): void {
  void window.appto.openExternal(url)
}

export function openFolder(path: string): Promise<void> {
  return window.appto.openFolder(path)
}

export function openResultFile(result: ResultRef): Promise<void> {
  return window.appto.openFile(result)
}

export function revealResultFile(result: ResultRef): Promise<void> {
  return window.appto.revealFile(result)
}

export function saveResultCopy(
  result: ResultRef,
  suggestedName: string
): Promise<boolean> {
  return window.appto.saveFileCopy(result, suggestedName)
}

export function pickProjectFolder() {
  return window.appto.pickProject()
}

export function pickPackFolder() {
  return window.appto.pickPack()
}
