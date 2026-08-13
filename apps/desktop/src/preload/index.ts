import { contextBridge, ipcRenderer } from "electron"

import {
  openExternalChannel,
  pickWorkspaceChannel,
  runtimeEventChannel,
  runtimeRequestChannel,
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
  pickWorkspace: () => ipcRenderer.invoke(pickWorkspaceChannel),
  openExternal: (url) => ipcRenderer.invoke(openExternalChannel, url),
}

contextBridge.exposeInMainWorld("appto", api)
