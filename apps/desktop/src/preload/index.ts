import { contextBridge, ipcRenderer } from "electron"

import {
  openExternalChannel,
  openFileChannel,
  openFolderChannel,
  pickPackChannel,
  pickProjectChannel,
  revealFileChannel,
  runtimeEventChannel,
  runtimeRequestChannel,
  saveFileCopyChannel,
} from "../shared/channels.js"
import type { DesktopApi } from "../shared/desktop-api.js"

const api: DesktopApi = {
  runtime: {
    request: (request) => ipcRenderer.invoke(runtimeRequestChannel, request),
    subscribe: (listener) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        value: Parameters<typeof listener>[0]
      ) => {
        listener(value)
      }
      ipcRenderer.on(runtimeEventChannel, handler)
      return () => ipcRenderer.removeListener(runtimeEventChannel, handler)
    },
  },
  pickProject: () => ipcRenderer.invoke(pickProjectChannel),
  pickPack: () => ipcRenderer.invoke(pickPackChannel),
  openExternal: (url) => ipcRenderer.invoke(openExternalChannel, url),
  openFolder: (path) => ipcRenderer.invoke(openFolderChannel, path),
  openFile: (result) => ipcRenderer.invoke(openFileChannel, result),
  revealFile: (result) => ipcRenderer.invoke(revealFileChannel, result),
  saveFileCopy: (result, suggestedName) =>
    ipcRenderer.invoke(saveFileCopyChannel, result, suggestedName),
}

contextBridge.exposeInMainWorld("appto", api)
