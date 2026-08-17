import { existsSync } from "node:fs"
import path from "node:path"

import { app, BrowserWindow, dialog, shell } from "electron"
import { z } from "zod"

import {
  BrowserMcpServer,
  ClaudeAdapter,
  CodexAdapter,
  createRuntime,
} from "@deskto/runtime"

import { configureCliPath } from "./cli-path.js"
import { BrowserManager } from "./browser/browser-manager.js"
import { registerDesktopIpc } from "./desktop-ipc.js"
import { registerRuntimeIpc } from "./runtime-ipc.js"
import { installContentSecurityPolicy } from "./security.js"
import { createMainWindow } from "./window.js"
import { browserEventChannel } from "../shared/channels.js"

const runtimeCloseTimeoutMs = 5_000
const fatalStartupDetailSchema = z
  .instanceof(Error)
  .transform((error) => error.stack ?? error.message)
  .catch("The application failed to start")

let closeRuntime: (() => Promise<void>) | undefined

function packagedClaudeExecutable(): string | undefined {
  if (!app.isPackaged) return undefined
  const packageNames = [
    `claude-agent-sdk-${process.platform}-${process.arch}`,
    `claude-agent-sdk-${process.platform}-${process.arch}-musl`,
  ]
  const executable = process.platform === "win32" ? "claude.exe" : "claude"
  for (const packageName of packageNames) {
    const candidate = path.join(
      process.resourcesPath,
      "app.asar.unpacked",
      "node_modules",
      "@anthropic-ai",
      packageName,
      executable
    )
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

async function openApplication(): Promise<void> {
  // The PATH probe spawns a login shell and can take a few seconds, so it runs
  // while the window opens and the renderer loads. The runtime gets it as the
  // probe gate: no harness CLI is spawned before PATH is rebuilt.
  const cliPathConfigured = configureCliPath()

  installContentSecurityPolicy()

  const window = createMainWindow()
  const browser = new BrowserManager(window, (event) => {
    if (!window.webContents.isDestroyed()) {
      window.webContents.send(browserEventChannel, event)
    }
  })
  let browserMcp: BrowserMcpServer
  try {
    browserMcp = await BrowserMcpServer.create(browser)
  } catch (error) {
    browser.close()
    throw error
  }

  const claudeExecutable = packagedClaudeExecutable()
  const claudeAdapter = claudeExecutable
    ? new ClaudeAdapter({
        executablePath: claudeExecutable,
        packShimsPath: path.join(app.getPath("userData"), "claude-pack-shims"),
      })
    : new ClaudeAdapter({
        packShimsPath: path.join(app.getPath("userData"), "claude-pack-shims"),
      })
  let runtime: ReturnType<typeof createRuntime>
  try {
    runtime = createRuntime({
      databasePath: path.join(app.getPath("userData"), "deskto.sqlite"),
      packsPath: path.join(app.getPath("userData"), "packs"),
      harnesses: [claudeAdapter, new CodexAdapter()],
      probeGate: cliPathConfigured,
      sessionTools: [browserMcp],
      fileActions: {
        trashItem: (targetPath) => shell.trashItem(targetPath),
      },
    })
  } catch (error) {
    await browserMcp.close()
    browser.close()
    throw error
  }
  // Install the cleanup path before IPC subscriptions so a later startup
  // failure still closes the runtime and Browser resources.
  closeRuntime = async () => {
    await runtime.close()
    await browserMcp.close()
    browser.close()
  }
  // File actions resolve results through the runtime, so they register once
  // it exists rather than at startup.
  registerDesktopIpc(runtime, browser)
  const unsubscribeBrowserRuntime = runtime.subscribe((event) => {
    if (event.type === "thread.deleted") browser.closeThread(event.threadId)
  })
  const unregisterRuntimeIpc = registerRuntimeIpc(runtime, window.webContents)
  closeRuntime = async () => {
    unsubscribeBrowserRuntime()
    unregisterRuntimeIpc()
    await runtime.close()
    await browserMcp.close()
    browser.close()
  }
}

function showFatalStartupError(detail: string): void {
  dialog.showErrorBox("Deskto failed to start", detail)
  app.quit()
}

function focusExistingMainWindow(): void {
  const window = BrowserWindow.getAllWindows().at(0)
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.focus()
}

// A runtime that cannot shut down cleanly should delay quitting, not block it.
async function closeRuntimeWithTimeout(
  close: () => Promise<void>
): Promise<void> {
  const timeout = new Promise<void>((resolve) => {
    setTimeout(resolve, runtimeCloseTimeoutMs)
  })
  await Promise.race([close().catch(() => undefined), timeout])
}

// A second launch would open another runtime on the same database; hand over
// to the running instance instead.
const isPrimaryInstance = app.requestSingleInstanceLock()

if (isPrimaryInstance) {
  app.on("second-instance", focusExistingMainWindow)
  app
    .whenReady()
    .then(() =>
      openApplication().catch((error) =>
        showFatalStartupError(fatalStartupDetailSchema.parse(error))
      )
    )
} else {
  app.quit()
}

app.on("before-quit", (event) => {
  if (!closeRuntime) return
  event.preventDefault()
  const close = closeRuntime
  closeRuntime = undefined
  void closeRuntimeWithTimeout(close).finally(() => app.quit())
})

app.on("window-all-closed", () => {
  app.quit()
})

// Route Ctrl+C in development and SIGTERM through the same clean shutdown as
// a regular quit.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => app.quit())
}
