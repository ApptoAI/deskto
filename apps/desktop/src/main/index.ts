import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { app } from "electron"

import { ClaudeAdapter, CodexAdapter, createRuntime } from "@openappto/runtime"

import { registerDesktopIpc } from "./desktop-ipc.js"
import { registerRuntimeIpc } from "./runtime-ipc.js"
import { installContentSecurityPolicy } from "./security.js"
import { createMainWindow } from "./window.js"

let closeRuntime: (() => Promise<void>) | undefined
const execFileAsync = promisify(execFile)

async function configureCliPath(): Promise<void> {
  const inherited = process.env.PATH?.split(path.delimiter) ?? []
  const shell = await readLoginShellPath()
  const fallbacks = [
    path.join(homedir(), ".local/bin"),
    path.join(homedir(), ".npm-global/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ]
  process.env.PATH = [...new Set([...shell, ...inherited, ...fallbacks])].join(
    path.delimiter
  )
}

async function readLoginShellPath(): Promise<string[]> {
  if (process.platform !== "darwin") return []
  try {
    const { stdout } = await execFileAsync("/bin/zsh", [
      "-lic",
      'printf "\\n__APPTO_PATH__%s" "$PATH"',
    ])
    const value = stdout.split("__APPTO_PATH__").at(-1)?.trim()
    return value ? value.split(path.delimiter) : []
  } catch {
    return []
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
  await configureCliPath()
  installContentSecurityPolicy()
  registerDesktopIpc()

  const claudeExecutable = packagedClaudeExecutable()
  const runtime = createRuntime({
    databasePath: path.join(app.getPath("userData"), "appto.sqlite"),
    harnesses: [
      new ClaudeAdapter(
        claudeExecutable ? { executablePath: claudeExecutable } : {}
      ),
      new CodexAdapter(),
    ],
  })
  const window = createMainWindow()
  const unregisterRuntimeIpc = registerRuntimeIpc(runtime, window.webContents)
  closeRuntime = async () => {
    unregisterRuntimeIpc()
    await runtime.close()
  }
}

app.whenReady().then(openApplication)

app.on("before-quit", (event) => {
  if (!closeRuntime) return
  event.preventDefault()
  const close = closeRuntime
  closeRuntime = undefined
  void close().finally(() => app.quit())
})

app.on("window-all-closed", () => {
  app.quit()
})
