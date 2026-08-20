import { ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron"

import {
  updateCheckChannel,
  updateEventChannel,
  updateInstallChannel,
  updateStateChannel,
} from "../shared/channels.js"
import type { UpdateManager } from "./update-manager.js"

function requireApplicationWindow(
  event: IpcMainInvokeEvent,
  webContents: WebContents
): void {
  if (
    event.sender !== webContents ||
    event.senderFrame !== webContents.mainFrame
  ) {
    throw new Error("Update actions are available only from the Deskto window.")
  }
}

export function registerUpdateIpc(
  manager: UpdateManager,
  webContents: WebContents
): () => void {
  ipcMain.handle(updateStateChannel, (event) => {
    requireApplicationWindow(event, webContents)
    return manager.getState()
  })
  ipcMain.handle(updateCheckChannel, (event) => {
    requireApplicationWindow(event, webContents)
    return manager.check()
  })
  ipcMain.handle(updateInstallChannel, (event) => {
    requireApplicationWindow(event, webContents)
    return manager.install()
  })

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
