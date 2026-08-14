import path from "node:path"

import { dialog, ipcMain, shell } from "electron"

import {
  openExternalChannel,
  pickProjectChannel,
} from "../shared/channels.js"
import type { PickedProject } from "../shared/desktop-api.js"

const allowedExternalProtocols = new Set(["http:", "https:"])

export function registerDesktopIpc(): void {
  ipcMain.handle(
    pickProjectChannel,
    async (): Promise<PickedProject | undefined> => {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory", "createDirectory"],
        title: "Open project folder",
      })
      const selectedPath = result.filePaths[0]
      if (result.canceled || !selectedPath) return undefined

      return { path: selectedPath, name: path.basename(selectedPath) }
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
