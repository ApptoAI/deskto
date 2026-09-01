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
  updateCheckChannel,
  updateEventChannel,
  updateInstallChannel,
  updateStateChannel,
  windowCloseChannel,
  windowMaximizeToggleChannel,
  windowMinimizeChannel,
  windowThemeChannel,
} from "../shared/channels.js"
import type { DesktopApi } from "../shared/desktop-api.js"
import { frostedShellArgument } from "../shared/window-layout.js"

const api: DesktopApi = {
  // Sandboxed preloads still see the process environment, which is how the
  // dev-only force flag crosses into the renderer without an IPC round trip.
  devFlags: {
    forceOnboarding: process.env.DESKTO_FORCE_ONBOARDING === "1",
    elementPicker: process.env.DESKTO_DEV_ELEMENT_PICKER === "1",
  },
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
  updates: {
    state: () => ipcRenderer.invoke(updateStateChannel),
    check: () => ipcRenderer.invoke(updateCheckChannel),
    install: () => ipcRenderer.invoke(updateInstallChannel),
    subscribe: (listener) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        value: Parameters<typeof listener>[0]
      ) => listener(value)
      ipcRenderer.on(updateEventChannel, handler)
      return () => ipcRenderer.removeListener(updateEventChannel, handler)
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
  platform: process.platform,
  // Main decides per platform and version; the answer rides in on argv
  // because a sandboxed preload has no other synchronous channel to it.
  frostedShell: process.argv.includes(frostedShellArgument),
  setNativeTheme: (dark) => ipcRenderer.send(windowThemeChannel, dark),
  windowControls: {
    minimize: () => ipcRenderer.send(windowMinimizeChannel),
    toggleMaximize: () => ipcRenderer.send(windowMaximizeToggleChannel),
    close: () => ipcRenderer.send(windowCloseChannel),
  },
}

contextBridge.exposeInMainWorld("deskto", api)
