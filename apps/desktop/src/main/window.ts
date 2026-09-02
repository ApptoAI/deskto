import os from "node:os"
import path from "node:path"

import { BrowserWindow, ipcMain, nativeTheme, screen } from "electron"
import { z } from "zod"

import {
  windowCloseChannel,
  windowMaximizeToggleChannel,
  windowMinimizeChannel,
  windowThemeChannel,
} from "../shared/channels.js"
import {
  frostedShellArgument,
  minimumWindowWidth,
} from "../shared/window-layout.js"

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
    the web contents, so it has to be the renderer's shell rather than a
    constant. The chosen theme is a Runtime setting and out of reach here
    until the Surface reports it over `windowThemeChannel`; before that this
    follows the operating system, so a user who picked the palette their
    system is not in gets one wrong frame on launch and none after.

    This is the body fallback behind the opaque shell. Keep it in step with
    --wp-base. */
function canvasColor(): string {
  return nativeTheme.shouldUseDarkColors ? "#151516" : "#f2f1ee"
}

export type ShellFrost = "vibrancy" | "acrylic" | null

/**
 * Which native blur the window can sit on. macOS has had vibrancy for every
 * version Electron runs on. Windows only has acrylic from 11 22H2 (build
 * 22621); asking an older build paints a transparent window with nothing
 * behind it, so it stays opaque there. Linux compositors vary too much to ask.
 */
export function shellFrost(
  platform: NodeJS.Platform,
  release: string
): ShellFrost {
  if (platform === "darwin") return "vibrancy"
  if (platform === "win32") {
    const build = Number(release.split(".")[2])
    return build >= 22621 ? "acrylic" : null
  }
  return null
}

/** The window options that only exist when a native blur is on. */
function frostOptions(
  frost: ShellFrost
): Pick<
  Electron.BrowserWindowConstructorOptions,
  "vibrancy" | "backgroundMaterial"
> {
  if (frost === "vibrancy") return { vibrancy: "under-window" }
  if (frost === "acrylic") return { backgroundMaterial: "acrylic" }
  return {}
}

export function createMainWindow(): BrowserWindow {
  const frost = shellFrost(process.platform, os.release())
  const window = new BrowserWindow({
    ...defaultWindowSize(),
    ...frostOptions(frost),
    // Wide enough for the widest sidebar, conversation floor, and task panel.
    minWidth: minimumWindowWidth,
    minHeight: 620,
    center: true,
    show: false,
    // macOS keeps native traffic lights; other platforms use renderer controls.
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    trafficLightPosition: { x: 14, y: 22 },
    // The Surface draws its own titlebar. macOS already keeps its menu in the
    // system bar, but Windows and Linux would otherwise stack a native menu
    // strip on top of ours, which is two rows of chrome for one window. Alt
    // still summons it.
    autoHideMenuBar: true,
    // A frosted window paints nothing of its own: the shell colour the
    // Surface lays over the blur is the only paint. The alpha channel in
    // that background colour is only honoured once the window itself is
    // marked transparent; without it Electron falls back to opaque and the
    // vibrancy or acrylic never shows through.
    transparent: frost !== null,
    backgroundColor: frost ? "#00000000" : canvasColor(),
    webPreferences: {
      preload: path.join(bundleDirectory, "../preload/index.cjs"),
      additionalArguments: frost ? [frostedShellArgument] : [],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Chromium's built-in PDF viewer is a plugin. Without this a PDF result
      // renders as a blank frame; with it, paging, zoom, search, and printing
      // come for free instead of shipping a PDF renderer of our own.
      plugins: true,
    },
  })

  // nativeTheme is global, so remove the listener with its window. A
  // frosted window keeps its clear background; the blur follows the theme.
  const followSystemCanvas = () => {
    if (!frost) window.setBackgroundColor(canvasColor())
  }
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
  // The Surface's palette drives the native side too: the blur under a
  // frosted shell and the colour of any frame painted before web contents.
  ipcMain.on(windowThemeChannel, (_event, payload) => {
    const dark = z.boolean().safeParse(payload)
    if (!dark.success) return
    nativeTheme.themeSource = dark.data ? "dark" : "light"
  })
  return () => {
    ipcMain.removeAllListeners(windowMinimizeChannel)
    ipcMain.removeAllListeners(windowMaximizeToggleChannel)
    ipcMain.removeAllListeners(windowCloseChannel)
    ipcMain.removeAllListeners(windowThemeChannel)
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
