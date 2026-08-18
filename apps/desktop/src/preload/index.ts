import { contextBridge, ipcRenderer } from "electron"

import {
  browserActionChannel,
  browserCancelSelectionChannel,
  browserEventChannel,
  browserHideChannel,
  browserNavigateChannel,
  browserOpenArtifactChannel,
  browserSelectElementChannel,
  browserShowChannel,
  browserStateChannel,
  openExternalChannel,
  openFileChannel,
  openFolderChannel,
  pickPackChannel,
  pickPackArchiveChannel,
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
  pickPackArchive: () => ipcRenderer.invoke(pickPackArchiveChannel),
  openExternal: (url) => ipcRenderer.invoke(openExternalChannel, url),
  openFolder: (path) => ipcRenderer.invoke(openFolderChannel, path),
  openFile: (result) => ipcRenderer.invoke(openFileChannel, result),
  revealFile: (result) => ipcRenderer.invoke(revealFileChannel, result),
  saveFileCopy: (result, suggestedName) =>
    ipcRenderer.invoke(saveFileCopyChannel, result, suggestedName),
  browser: {
    show: (threadId, bounds) =>
      ipcRenderer.invoke(browserShowChannel, threadId, bounds),
    hide: (threadId) => ipcRenderer.invoke(browserHideChannel, threadId),
    state: (threadId) => ipcRenderer.invoke(browserStateChannel, threadId),
    navigate: (threadId, url) =>
      ipcRenderer.invoke(browserNavigateChannel, threadId, url),
    action: (threadId, action) =>
      ipcRenderer.invoke(browserActionChannel, threadId, action),
    openArtifact: (result) =>
      ipcRenderer.invoke(browserOpenArtifactChannel, result),
    selectElement: (threadId) =>
      ipcRenderer.invoke(browserSelectElementChannel, threadId),
    cancelElementSelection: (threadId) =>
      ipcRenderer.invoke(browserCancelSelectionChannel, threadId),
    subscribe: (listener) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        value: Parameters<typeof listener>[0]
      ) => listener(value)
      ipcRenderer.on(browserEventChannel, handler)
      return () => ipcRenderer.removeListener(browserEventChannel, handler)
    },
  },
}

contextBridge.exposeInMainWorld("deskto", api)
