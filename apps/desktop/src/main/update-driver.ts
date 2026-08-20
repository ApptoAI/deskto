import electronUpdater from "electron-updater"

export type UpdateDriverListeners = {
  checking: () => void
  available: (version: string) => void
  notAvailable: () => void
  progress: (percent: number) => void
  downloaded: (version: string) => void
  cancelled: () => void
  error: () => void
}

export interface UpdateDriver {
  subscribe(listeners: UpdateDriverListeners): () => void
  checkForUpdates(): Promise<void>
  quitAndInstall(): void
}

/** Keeps the CommonJS package import and provider events out of app state. */
export function createElectronUpdateDriver(): UpdateDriver {
  // electron-updater is CommonJS. Reading the named export from its default
  // object works in both the bundled ESM main process and Node-based tests.
  const { autoUpdater } = electronUpdater
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false

  return {
    subscribe(listeners) {
      const onChecking = () => listeners.checking()
      const onAvailable = (info: { version: string }) =>
        listeners.available(info.version)
      const onNotAvailable = () => listeners.notAvailable()
      const onProgress = (info: { percent: number }) =>
        listeners.progress(info.percent)
      const onDownloaded = (info: { version: string }) =>
        listeners.downloaded(info.version)
      const onCancelled = () => listeners.cancelled()
      const onError = () => listeners.error()

      autoUpdater.on("checking-for-update", onChecking)
      autoUpdater.on("update-available", onAvailable)
      autoUpdater.on("update-not-available", onNotAvailable)
      autoUpdater.on("download-progress", onProgress)
      autoUpdater.on("update-downloaded", onDownloaded)
      autoUpdater.on("update-cancelled", onCancelled)
      autoUpdater.on("error", onError)

      return () => {
        autoUpdater.off("checking-for-update", onChecking)
        autoUpdater.off("update-available", onAvailable)
        autoUpdater.off("update-not-available", onNotAvailable)
        autoUpdater.off("download-progress", onProgress)
        autoUpdater.off("update-downloaded", onDownloaded)
        autoUpdater.off("update-cancelled", onCancelled)
        autoUpdater.off("error", onError)
      }
    },
    async checkForUpdates() {
      const result = await autoUpdater.checkForUpdates()
      await result?.downloadPromise
    },
    quitAndInstall() {
      autoUpdater.quitAndInstall(false, true)
    },
  }
}
