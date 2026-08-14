import { spawn } from "node:child_process"
import { homedir } from "node:os"
import path from "node:path"

// A wedged shell profile (a prompt waiting for input, a broken plugin) must
// not be able to stall the app, so the probe is killed after this delay.
const loginShellTimeoutMs = 5_000

// Noisy profiles can print a lot of banner around the fenced value; anything
// beyond this is dropped rather than buffered.
const maxProbeOutputLength = 4_000_000

// The shell profile may print anything before or after the probe output, so
// the value is fenced with markers instead of trusting the stream as a whole.
const pathStartMarker = "__APPTO_PATH_START__"
const pathEndMarker = "__APPTO_PATH_END__"

// Shells whose -ilc flags and "$PATH" expansion behave the POSIX way. fish is
// handled separately; anything else (tcsh, nu, ...) gets the stock shell.
const posixShells = new Set(["zsh", "bash", "sh", "ksh", "dash"])

const fallbackBinDirectories = [
  path.join(homedir(), ".local/bin"),
  path.join(homedir(), ".npm-global/bin"),
  "/opt/homebrew/bin",
  "/usr/local/bin",
]

/**
 * GUI applications launched from the Dock or a desktop environment inherit a
 * minimal PATH without the entries added by the user's shell profile, so the
 * CLIs the runtime spawns (claude, codex) are often not findable. Rebuilds
 * PATH from the login shell, the inherited environment and a few well-known
 * install locations.
 */
export async function configureCliPath(): Promise<void> {
  const loginShell = await readLoginShellPath()
  const inherited = process.env.PATH?.split(path.delimiter) ?? []
  process.env.PATH = [
    ...new Set([...loginShell, ...inherited, ...fallbackBinDirectories]),
  ].join(path.delimiter)
}

async function readLoginShellPath(): Promise<string[]> {
  if (process.platform === "win32") return []
  const { shell, command } = pathProbe()
  try {
    // -i loads the interactive profile (such as .zshrc), where PATH edits
    // usually live.
    const output = await runShell(shell, ["-ilc", command])
    const value = extractMarkedPath(output)
    return value ? value.split(path.delimiter) : []
  } catch (error) {
    console.warn(
      `Reading PATH from ${shell} failed:`,
      error instanceof Error ? error.message : error
    )
    return []
  }
}

function pathProbe(): { shell: string; command: string } {
  const fallback = process.platform === "darwin" ? "/bin/zsh" : "/bin/bash"
  const configured = process.env.SHELL
  const name = configured ? path.basename(configured) : ""
  const marked = (pathExpansion: string) =>
    `printf "%s%s%s" "${pathStartMarker}" ${pathExpansion} "${pathEndMarker}"`

  // fish stores PATH as a list and expands "$PATH" space-separated, so the
  // colons have to be joined explicitly.
  if (configured && name === "fish") {
    return { shell: configured, command: marked("(string join : $PATH)") }
  }
  if (configured && posixShells.has(name)) {
    return { shell: configured, command: marked('"$PATH"') }
  }
  return { shell: fallback, command: marked('"$PATH"') }
}

// spawn instead of execFile: stdin stays closed so profiles that read from it
// cannot block, and output is capped instead of failing on a maxBuffer limit.
function runShell(shell: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(shell, args, {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: loginShellTimeoutMs,
    })
    let output = ""
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      if (output.length < maxProbeOutputLength) output += chunk
    })
    child.on("error", reject)
    child.on("close", (_code, signal) => {
      if (signal) {
        reject(new Error(`${shell} was stopped by ${signal}`))
      } else {
        resolve(output)
      }
    })
  })
}

function extractMarkedPath(output: string): string | undefined {
  const start = output.indexOf(pathStartMarker)
  if (start === -1) return undefined
  const end = output.indexOf(pathEndMarker, start)
  if (end === -1) return undefined
  return output.slice(start + pathStartMarker.length, end).trim() || undefined
}
