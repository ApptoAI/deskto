import path from "node:path"

import { BrowserWindow, screen } from "electron"

/** Opens large on a roomy display without overflowing a small one: most of
    the work area, capped so it never becomes an unwieldy full-screen sheet. */
function defaultWindowSize(): { width: number; height: number } {
  const workArea = screen.getPrimaryDisplay().workAreaSize
  return {
    width: Math.min(1760, Math.round(workArea.width * 0.9)),
    height: Math.min(1100, Math.round(workArea.height * 0.92)),
  }
}

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    ...defaultWindowSize(),
    minWidth: 900,
    minHeight: 620,
    center: true,
    show: false,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0a0a0a",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

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
