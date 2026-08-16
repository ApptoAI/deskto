/** Desktop-only capabilities, kept apart from the Runtime protocol. */
import type { ResultRef } from "../../shared/desktop-api.js"

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
