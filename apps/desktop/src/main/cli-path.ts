import { execFile } from "node:child_process"
import { readdir } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

type CliPathOptions = {
  platform?: NodeJS.Platform
  environment?: NodeJS.ProcessEnv
  windowsPathReader?: () => Promise<string | undefined>
}

const windowsEnvironmentPathCommand = [
  "$user = [Environment]::GetEnvironmentVariable('PATH', 'User')",
  "$machine = [Environment]::GetEnvironmentVariable('PATH', 'Machine')",
  "[Console]::Out.Write((@($user, $machine) | Where-Object { $_ }) -join ';')",
].join("; ")

/**
 * GUI applications inherit a minimal PATH. Build on it with the documented
 * native installer locations and common package-manager shims without
 * executing the person's shell profiles during application startup.
 */
export async function configureCliPath(
  homeDirectory = homedir(),
  options: CliPathOptions = {}
): Promise<void> {
  const platform = options.platform ?? process.platform
  const environment = options.environment ?? process.env
  const pathApi = platform === "win32" ? path.win32 : path.posix
  const pathKey =
    Object.keys(environment).find((key) => key.toUpperCase() === "PATH") ??
    "PATH"
  const inherited = environment[pathKey]?.split(pathApi.delimiter) ?? []
  const persisted =
    platform === "win32"
      ? await (
          options.windowsPathReader ??
          (() => readWindowsEnvironmentPath(environment))
        )()
      : undefined
  const versionedNodeBins = await discoverVersionedNodeBins(
    homeDirectory,
    platform,
    pathApi
  )
  environment[pathKey] = uniquePathEntries(
    [
      ...(persisted?.split(pathApi.delimiter) ?? []),
      ...inherited,
      ...fixedBinDirectories(homeDirectory, platform, environment, pathApi),
      ...versionedNodeBins,
    ],
    platform
  ).join(pathApi.delimiter)
}

function uniquePathEntries(
  entries: string[],
  platform: NodeJS.Platform
): string[] {
  const unique: string[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    const trimmed = entry.trim()
    if (!trimmed) continue
    const key = platform === "win32" ? trimmed.toLowerCase() : trimmed
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(trimmed)
  }
  return unique
}

export async function readWindowsEnvironmentPath(
  environment: NodeJS.ProcessEnv = process.env,
  probe: (
    shell: string
  ) => Promise<string | undefined> = executeWindowsPathProbe
): Promise<string | undefined> {
  const systemRoot =
    Object.entries(environment).find(
      ([key, value]) => key.toUpperCase() === "SYSTEMROOT" && value
    )?.[1] ?? undefined
  const shells = [
    "pwsh.exe",
    "powershell.exe",
    ...(systemRoot
      ? [
          path.win32.join(
            systemRoot,
            "System32/WindowsPowerShell/v1.0/powershell.exe"
          ),
        ]
      : []),
  ]
  for (const shell of shells) {
    const value = await probe(shell)
    if (value) return value
  }
  return undefined
}

function executeWindowsPathProbe(shell: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      shell,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        windowsEnvironmentPathCommand,
      ],
      { encoding: "utf8", timeout: 5_000, windowsHide: true },
      (error, stdout) => {
        const value = error ? "" : stdout.trim()
        resolve(value || undefined)
      }
    )
  })
}

function fixedBinDirectories(
  homeDirectory: string,
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
  pathApi: typeof path.posix | typeof path.win32
): string[] {
  const directories = [
    pathApi.join(homeDirectory, ".local/bin"),
    pathApi.join(homeDirectory, ".npm-global/bin"),
    pathApi.join(homeDirectory, ".volta/bin"),
    pathApi.join(homeDirectory, ".asdf/shims"),
    pathApi.join(homeDirectory, ".nodenv/shims"),
    pathApi.join(homeDirectory, ".local/share/mise/shims"),
    pathApi.join(homeDirectory, ".local/share/pnpm"),
    pathApi.join(homeDirectory, ".bun/bin"),
    pathApi.join(homeDirectory, ".deno/bin"),
    pathApi.join(homeDirectory, ".cargo/bin"),
  ]
  if (platform === "win32") {
    if (environment.APPDATA) {
      directories.push(pathApi.join(environment.APPDATA, "npm"))
    }
    if (environment.LOCALAPPDATA) {
      directories.push(
        pathApi.join(environment.LOCALAPPDATA, "Programs/nodejs"),
        pathApi.join(environment.LOCALAPPDATA, "Volta/bin"),
        pathApi.join(environment.LOCALAPPDATA, "pnpm"),
        pathApi.join(environment.LOCALAPPDATA, "Microsoft/WinGet/Links")
      )
    }
    if (environment.PNPM_HOME) directories.push(environment.PNPM_HOME)
    if (environment.NVM_SYMLINK) directories.push(environment.NVM_SYMLINK)
    directories.push(pathApi.join(homeDirectory, "scoop/shims"))
  } else {
    directories.push("/opt/homebrew/bin", "/usr/local/bin")
  }
  if (platform === "darwin") {
    directories.push(pathApi.join(homeDirectory, "Library/pnpm"))
  }
  return directories
}

async function discoverVersionedNodeBins(
  homeDirectory: string,
  platform: NodeJS.Platform,
  pathApi: typeof path.posix | typeof path.win32
): Promise<string[]> {
  if (platform === "win32") return []

  const roots = [
    {
      path: pathApi.join(homeDirectory, ".nvm/versions/node"),
      suffix: ["bin"],
    },
    {
      path: pathApi.join(homeDirectory, ".fnm/node-versions"),
      suffix: ["installation", "bin"],
    },
    {
      path: pathApi.join(homeDirectory, ".local/share/fnm/node-versions"),
      suffix: ["installation", "bin"],
    },
  ]
  if (platform === "darwin") {
    roots.push({
      path: pathApi.join(
        homeDirectory,
        "Library/Application Support/fnm/node-versions"
      ),
      suffix: ["installation", "bin"],
    })
  }

  const discovered = await Promise.all(
    roots.map(async (root) => {
      const entries = await readdir(root.path, { withFileTypes: true }).catch(
        () => []
      )
      return entries
        .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
        .map((entry) => entry.name)
        .sort((left, right) =>
          right.localeCompare(left, undefined, { numeric: true })
        )
        .map((name) => pathApi.join(root.path, name, ...root.suffix))
    })
  )
  return discovered.flat()
}
