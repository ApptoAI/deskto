import path from "node:path"

import { BrowserWindow, nativeTheme, screen } from "electron"

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
    process can get on its own. */
function canvasColor(): string {
  return nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff"
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
      preload: path.join(__dirname, "../preload/index.cjs"),
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

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(path.join(__dirname, "../renderer/index.html"))
  }

  return window
}
