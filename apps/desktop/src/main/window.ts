import path from "node:path"

import { BrowserWindow, nativeTheme, screen } from "electron"

/**
 * The main bundle is ESM, where `__dirname` exists only if the bundler injects
 * a shim — and electron-vite injects that shim after the last `import` line it
 * finds, which a dependency's doc comment can swallow. Asking the module for
 * its own directory does not depend on where a banner lands.
 */
const bundleDirectory = import.meta.dirname

/** Opens large on a roomy display without overflowing a small one: most of
    the work area, capped so it never becomes an unwieldy full-screen sheet. */
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
  return nativeTheme.shouldUseDarkColors ? "#232327" : "#e8e8ec"
}

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    ...defaultWindowSize(),
    minWidth: 900,
    minHeight: 620,
    center: true,
    show: false,
    titleBarStyle: "hiddenInset",
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

  // The colour is only read at construction, and a window outlives any one
  // system palette.
  const followSystemCanvas = () => window.setBackgroundColor(canvasColor())
  nativeTheme.on("updated", followSystemCanvas)
  window.once("closed", () => nativeTheme.off("updated", followSystemCanvas))

  window.once("ready-to-show", () => window.show())
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  window.webContents.on("will-navigate", (event) => event.preventDefault())

  return window
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
