import { existsSync } from "node:fs"
import path from "node:path"

import { app, BrowserWindow, dialog } from "electron"

import { ClaudeAdapter, CodexAdapter, createRuntime } from "@openappto/runtime"

import { configureCliPath } from "./cli-path.js"
import { registerDesktopIpc } from "./desktop-ipc.js"
import { registerRuntimeIpc } from "./runtime-ipc.js"
import { installContentSecurityPolicy } from "./security.js"
import { createMainWindow } from "./window.js"

const runtimeCloseTimeoutMs = 5_000

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
  registerDesktopIpc()

  const claudeExecutable = packagedClaudeExecutable()
  const runtime = createRuntime({
    databasePath: path.join(app.getPath("userData"), "appto.sqlite"),
    packsPath: path.join(app.getPath("userData"), "packs"),
    harnesses: [
      new ClaudeAdapter({
        ...(claudeExecutable ? { executablePath: claudeExecutable } : {}),
        packShimsPath: path.join(app.getPath("userData"), "claude-pack-shims"),
      }),
      new CodexAdapter(),
    ],
    probeGate: cliPathConfigured,
  })
  // Assigned before the window opens so a failure below still closes the
  // runtime through the before-quit path.
  closeRuntime = () => runtime.close()

  const window = createMainWindow()
  const unregisterRuntimeIpc = registerRuntimeIpc(runtime, window.webContents)
  closeRuntime = async () => {
    unregisterRuntimeIpc()
    await runtime.close()
  }
}

function showFatalStartupError(error: unknown): void {
  const detail =
    error instanceof Error ? (error.stack ?? error.message) : String(error)
  dialog.showErrorBox("Appto failed to start", detail)
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
  app.whenReady().then(() => openApplication().catch(showFatalStartupError))
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
