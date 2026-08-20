import { ipcMain, type WebContents } from "electron"

import {
  updateCheckChannel,
  updateEventChannel,
  updateInstallChannel,
  updateStateChannel,
} from "../shared/channels.js"
import type { UpdateManager } from "./update-manager.js"

export function registerUpdateIpc(
  manager: UpdateManager,
  webContents: WebContents
): () => void {
  ipcMain.handle(updateStateChannel, () => manager.getState())
  ipcMain.handle(updateCheckChannel, () => manager.check())
  ipcMain.handle(updateInstallChannel, () => manager.install())

  const unsubscribe = manager.subscribe((state) => {
    if (!webContents.isDestroyed()) webContents.send(updateEventChannel, state)
  })

  return () => {
    unsubscribe()
    ipcMain.removeHandler(updateStateChannel)
    ipcMain.removeHandler(updateCheckChannel)
    ipcMain.removeHandler(updateInstallChannel)
  }
}
