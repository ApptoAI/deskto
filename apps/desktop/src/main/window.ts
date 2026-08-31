import path from "node:path"

import { BrowserWindow, ipcMain, nativeTheme, screen } from "electron"

import {
  windowCloseChannel,
  windowMaximizeToggleChannel,
  windowMinimizeChannel,
} from "../shared/channels.js"

/**
 * The main bundle is ESM, where `__dirname` exists only if the bundler injects
 * a shim — and electron-vite injects that shim after the last `import` line it
 * finds, which a dependency's doc comment can swallow. Asking the module for
 * its own directory does not depend on where a banner lands.
 */
const bundleDirectory = import.meta.dirname

function defaultWindowSize() {
  const workArea = screen.getPrimaryDisplay().workAreaSize
  return {
    width: Math.min(1760, Math.round(workArea.width * 0.9)),
    height: Math.min(1100, Math.round(workArea.height * 0.92)),
  }
}

/** What `ready-to-show` paints and what fills the gap when a resize outruns
    the web contents, so it has to be the renderer's canvas rather than a
    constant. The chosen theme is a Runtime setting and out of reach here, so
    this follows the operating system: a user who picked the palette their
    system is not in still gets one wrong frame, which is as close as the main
    process can get on its own.

    This is the wallpaper's base stop rather than a surface colour: the Surface
    paints the wallpaper and floats glass on it, so the deepest thing behind
    everything is what a torn frame should show. Keep in step with --wp-base. */
function canvasColor(): string {
  return nativeTheme.shouldUseDarkColors ? "#202024" : "#d6d6e0"
}

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    ...defaultWindowSize(),
    // Wide enough for the layout to keep its own promises: the task list at
    // 288, the conversation's declared floor at 520, and the task panel's
    // minimum at 280. Below this the conversation is squeezed under the width
    // its composer needs, which is how its controls ended up on top of one
    // another. Keep in step with task-panel-size.ts.
    minWidth: 1088,
    minHeight: 620,
    center: true,
    show: false,
    // macOS keeps native traffic lights; other platforms use renderer controls.
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    trafficLightPosition: { x: 16, y: 20 },
    // The Surface draws its own titlebar. macOS already keeps its menu in the
    // system bar, but Windows and Linux would otherwise stack a native menu
    // strip on top of ours, which is two rows of chrome for one window. Alt
    // still summons it.
    autoHideMenuBar: true,
    backgroundColor: canvasColor(),
    webPreferences: {
      preload: path.join(bundleDirectory, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Chromium's built-in PDF viewer is a plugin. Without this a PDF result
      // renders as a blank frame; with it, paging, zoom, search, and printing
      // come for free instead of shipping a PDF renderer of our own.
      plugins: true,
    },
  })

  // nativeTheme is global, so remove the listener with its window.
  const followSystemCanvas = () => window.setBackgroundColor(canvasColor())
  nativeTheme.on("updated", followSystemCanvas)
  window.once("closed", () => nativeTheme.off("updated", followSystemCanvas))

  window.once("ready-to-show", () => window.show())
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  window.webContents.on("will-navigate", (event) => event.preventDefault())

  return window
}

/** Serves the titlebar's window controls on platforms that hide the native
    ones. One listener per window; the last-registered window wins, which is
    the window a person can see (there is only ever one). */
export function registerWindowControlsIpc(window: BrowserWindow): () => void {
  ipcMain.on(windowMinimizeChannel, () => window.minimize())
  ipcMain.on(windowMaximizeToggleChannel, () =>
    window.isMaximized() ? window.unmaximize() : window.maximize()
  )
  ipcMain.on(windowCloseChannel, () => window.close())
  return () => {
    ipcMain.removeAllListeners(windowMinimizeChannel)
    ipcMain.removeAllListeners(windowMaximizeToggleChannel)
    ipcMain.removeAllListeners(windowCloseChannel)
  }
}

export interface LoadableMainWindow {
  loadFile(filePath: string): Promise<void>
  loadURL(url: string): Promise<void>
}

/** Loads the Surface only after the main process has registered every IPC
    handler it can call during its first render. */
export function loadMainWindow(window: LoadableMainWindow): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(path.join(bundleDirectory, "../renderer/index.html"))
  }
}
