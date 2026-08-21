import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import path from "node:path"

import { app, BrowserWindow, dialog, protocol, shell } from "electron"
import { z } from "zod"

import { startDesktoMcpServer, type DesktoMcpServer } from "@deskto/mcp-server"
import {
  BrowserMcpServer,
  ClaudeAdapter,
  claudeNotSignedInReason,
  CodexAdapter,
  codexNotInstalledReason,
  createRuntime,
  type SessionToolProvider,
} from "@deskto/runtime"

import { discoverArtifactRuntime } from "./artifact-runtime.js"
import { withForcedUnavailability } from "./dev-harness-stubs.js"
import { browserArtifactScheme } from "./browser/browser-artifact.js"
import { BrowserManager } from "./browser/browser-manager.js"
import { configureCliPath } from "./cli-path.js"
import { registerDesktopIpc } from "./desktop-ipc.js"
import { registerRuntimeIpc } from "./runtime-ipc.js"
import { installContentSecurityPolicy } from "./security.js"
import { createElectronUpdateDriver } from "./update-driver.js"
import { registerUpdateIpc } from "./update-ipc.js"
import { UpdateManager } from "./update-manager.js"
import { createMainWindow } from "./window.js"
import { browserEventChannel } from "../shared/channels.js"

const runtimeCloseTimeoutMs = 5_000

protocol.registerSchemesAsPrivileged([
  {
    scheme: browserArtifactScheme,
    privileges: {
      standard: true,
      secure: true,
      stream: true,
    },
  },
])
const fatalStartupDetailSchema = z
  .instanceof(Error)
  .transform((error) => error.stack ?? error.message)
  .catch("The application failed to start")

let closeRuntime: (() => Promise<void>) | undefined

type McpServerReference = { current: DesktoMcpServer | undefined }

function taskOrchestrationProvider(
  reference: McpServerReference
): SessionToolProvider {
  return {
    open(input) {
      const server = reference.current
      if (!server) return Promise.resolve(undefined)
      const connection = server.connectionFor(input)
      let closed = false
      return Promise.resolve({
        mcpServers: [
          {
            id: connection.id,
            url: connection.url,
            authorization: {
              type: "bearer" as const,
              token: connection.authorizationToken,
            },
          },
        ],
        close() {
          if (!closed) {
            closed = true
            server.revokeTurn(input.turnId)
          }
          return Promise.resolve()
        },
      })
    },
  }
}

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
  // The sandboxed preload reads the environment it inherits from here, so
  // clearing the dev-only flag is what keeps devFlags false in packaged
  // builds even when the variable is exported in the launching shell.
  if (app.isPackaged) delete process.env.DESKTO_FORCE_ONBOARDING

  // Discovery processes must not inherit a launch directory such as the
  // person's home folder. A CLI inspecting it would make macOS ask Deskto
  // for unrelated Desktop, Documents, or Downloads access.
  const harnessDiscoveryPath = path.join(
    app.getPath("userData"),
    "harness-discovery"
  )
  await mkdir(harnessDiscoveryPath, { recursive: true, mode: 0o700 })

  // PATH discovery can inspect version-manager directories, so it runs while
  // the window opens. No harness CLI starts before the rebuilt PATH is ready.
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

  const artifactRuntime = await discoverArtifactRuntime()
  const claudeExecutable = packagedClaudeExecutable()
  const claudeAdapter = claudeExecutable
    ? new ClaudeAdapter({
        executablePath: claudeExecutable,
        hostSkillRoots: artifactRuntime?.skillRoots,
        discoveryCwd: harnessDiscoveryPath,
        packShimsPath: path.join(app.getPath("userData"), "claude-pack-shims"),
      })
    : new ClaudeAdapter({
        hostSkillRoots: artifactRuntime?.skillRoots,
        discoveryCwd: harnessDiscoveryPath,
        packShimsPath: path.join(app.getPath("userData"), "claude-pack-shims"),
      })
  const codexAdapter = new CodexAdapter(undefined, {
    discoveryCwd: harnessDiscoveryPath,
    hostSkillRoots: artifactRuntime?.skillRoots,
  })
  // Separate from DESKTO_FORCE_ONBOARDING on purpose: forcing the wizard
  // keeps real detection, so a machine with agents can walk the happy path;
  // this flag adds the fresh-machine look where both cards stay red.
  const simulateNoAgents =
    !app.isPackaged && process.env.DESKTO_SIMULATE_NO_AGENTS === "1"
  const harnesses = simulateNoAgents
    ? [
        withForcedUnavailability(claudeAdapter, claudeNotSignedInReason),
        withForcedUnavailability(codexAdapter, codexNotInstalledReason),
      ]
    : [claudeAdapter, codexAdapter]
  const mcpServerRef: McpServerReference = { current: undefined }
  let runtime: ReturnType<typeof createRuntime>
  try {
    runtime = createRuntime({
      databasePath: path.join(app.getPath("userData"), "deskto.sqlite"),
      packsPath: path.join(app.getPath("userData"), "packs"),
      projectsPath: path.join(app.getPath("userData"), "projects"),
      harnesses,
      probeGate: cliPathConfigured,
      sessionTools: [browserMcp, taskOrchestrationProvider(mcpServerRef)],
      fileActions: {
        trashItem: (targetPath) => shell.trashItem(targetPath),
      },
    })
  } catch (error) {
    await browserMcp.close()
    browser.close()
    throw error
  }
  // Install cleanup before the orchestration server starts so a startup
  // failure still closes the Runtime and Browser resources.
  closeRuntime = async () => {
    await Promise.allSettled([runtime.close(), browserMcp.close()])
    browser.close()
  }
  let mcpServer: DesktoMcpServer
  try {
    mcpServer = await startDesktoMcpServer({
      runtime,
      artifactRuntime: artifactRuntime?.dependencies,
    })
    mcpServerRef.current = mcpServer
  } catch (error) {
    const close = closeRuntime
    closeRuntime = undefined
    await close()
    throw error
  }
  const closeApplicationRuntime = async () => {
    mcpServerRef.current = undefined
    await Promise.allSettled([
      runtime.close(),
      mcpServer.close(),
      browserMcp.close(),
    ])
    browser.close()
  }
  closeRuntime = closeApplicationRuntime
  // File actions resolve results through the runtime, so they register once
  // it exists rather than at startup.
  registerDesktopIpc(runtime, browser)
  const unsubscribeBrowserRuntime = runtime.subscribe((event) => {
    if (event.type === "thread.deleted") browser.closeThread(event.threadId)
  })
  const unregisterRuntimeIpc = registerRuntimeIpc(runtime, window.webContents)
  const updateManager = new UpdateManager(
    app.getVersion(),
    app.isPackaged ? createElectronUpdateDriver() : undefined
  )
  const unregisterUpdateIpc = registerUpdateIpc(
    updateManager,
    window.webContents
  )
  updateManager.start()
  closeRuntime = async () => {
    updateManager.dispose()
    unregisterUpdateIpc()
    unsubscribeBrowserRuntime()
    unregisterRuntimeIpc()
    await closeApplicationRuntime()
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
