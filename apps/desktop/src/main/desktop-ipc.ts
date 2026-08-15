import { stat } from "node:fs/promises"
import path from "node:path"

import { dialog, ipcMain, shell } from "electron"

import {
  openExternalChannel,
  openFolderChannel,
  pickPackChannel,
  pickProjectChannel,
} from "../shared/channels.js"
import type { PickedProject } from "../shared/desktop-api.js"

const allowedExternalProtocols = new Set(["http:", "https:"])

function handleFolderPick(channel: string, title: string): void {
  ipcMain.handle(channel, async (): Promise<PickedProject | undefined> => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title,
    })
    const selectedPath = result.filePaths[0]
    if (result.canceled || !selectedPath) return undefined

    return { path: selectedPath, name: path.basename(selectedPath) }
  })
}

export function registerDesktopIpc(): void {
  handleFolderPick(pickProjectChannel, "Open project folder")
  handleFolderPick(pickPackChannel, "Choose a pack folder")

  // Directories only: shell.openPath on a file would hand it to whatever
  // app claims that type, so a stray path could launch something. A folder
  // just opens the file manager.
  ipcMain.handle(
    openFolderChannel,
    async (_event, value: unknown): Promise<void> => {
      if (typeof value !== "string" || !path.isAbsolute(value)) return

      try {
        const entry = await stat(value)
        if (!entry.isDirectory()) return
        await shell.openPath(value)
      } catch {
        return
      }
    }
  )

  ipcMain.handle(
    openExternalChannel,
    async (_event, value: unknown): Promise<void> => {
      if (typeof value !== "string") return

      try {
        const url = new URL(value)
        if (!allowedExternalProtocols.has(url.protocol)) return
        await shell.openExternal(url.toString())
      } catch {
        return
      }
    }
  )
}
