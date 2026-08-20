import { execFile } from "node:child_process"
import { constants } from "node:fs"
import { access, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"
import { promisify } from "node:util"

import type { ArtifactRuntimeDependencies } from "@deskto/mcp-server"
import { z } from "zod"

const runtimeManifestSchema = z.object({
  artifactToolVersion: z.string(),
  bundleVersion: z.string(),
  nodeVersion: z.string(),
  pythonVersion: z.string(),
  targetArch: z.string(),
  targetPlatform: z.string(),
})

const artifactPackageSchema = z.object({
  name: z.literal("@oai/artifact-tool"),
  version: z.string(),
  exports: z.object({ ".": z.string() }),
})

const artifactPluginNames = [
  "documents",
  "pdf",
  "presentations",
  "spreadsheets",
] as const
const execFileAsync = promisify(execFile)
const runtimeProbeTimeoutMs = 10_000

export type DiscoveredArtifactRuntime = {
  dependencies: ArtifactRuntimeDependencies
  skillRoots: Array<{ id: string; name: string; path: string }>
}

type DiscoveryOptions = {
  explicitRoot?: string
  configPath?: string
  cacheRoot?: string
  codexHome?: string
  platform?: NodeJS.Platform
  arch?: string
}

export async function discoverArtifactRuntime(
  options: DiscoveryOptions = {}
): Promise<DiscoveredArtifactRuntime | undefined> {
  const codexHome =
    options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex")
  const candidates = [
    options.explicitRoot ?? process.env.DESKTO_ARTIFACT_RUNTIME_ROOT,
    await configuredRuntimeRoot(
      options.configPath ?? join(codexHome, "config.toml")
    ),
    join(
      options.cacheRoot ??
        process.env.XDG_CACHE_HOME ??
        join(homedir(), ".cache"),
      "codex-runtimes",
      "codex-primary-runtime"
    ),
  ].filter((candidate): candidate is string => Boolean(candidate))

  for (const rootPath of new Set(candidates.map((path) => resolve(path)))) {
    const runtime = await artifactRuntimeAt(
      rootPath,
      options.platform ?? process.platform,
      options.arch ?? process.arch
    )
    if (runtime) return runtime
  }
  return undefined
}

async function configuredRuntimeRoot(
  configPath: string
): Promise<string | undefined> {
  let config: string
  try {
    config = await readFile(configPath, "utf8")
  } catch {
    return undefined
  }

  let inPrimaryRuntime = false
  for (const line of config.split(/\r?\n/)) {
    const section = /^\s*\[([^\]]+)]\s*$/.exec(line)
    if (section) {
      inPrimaryRuntime = section[1] === "marketplaces.openai-primary-runtime"
      continue
    }
    if (!inPrimaryRuntime) continue
    const source = /^\s*source\s*=\s*(.+?)\s*$/.exec(line)?.[1]
    if (!source) continue
    const parsed = tomlString(source)
    return parsed ? dirname(dirname(parsed)) : undefined
  }
  return undefined
}

function tomlString(value: string): string | undefined {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed = z.string().safeParse(JSON.parse(value))
      return parsed.success ? parsed.data : undefined
    } catch {
      return undefined
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1)
  return undefined
}

async function artifactRuntimeAt(
  rootPath: string,
  platform: NodeJS.Platform,
  arch: string
): Promise<DiscoveredArtifactRuntime | undefined> {
  const dependencies = join(rootPath, "dependencies")
  const nodeExecutable =
    platform === "win32"
      ? join(dependencies, "node", "node.exe")
      : join(dependencies, "node", "bin", "node")
  const nodeModulesPath = join(dependencies, "node", "node_modules")
  const pythonExecutable =
    platform === "win32"
      ? join(dependencies, "python", "python.exe")
      : join(dependencies, "python", "bin", "python3")
  const manifestPath = join(rootPath, "runtime.json")
  try {
    const manifest = runtimeManifestSchema.parse(
      JSON.parse(await readFile(manifestPath, "utf8"))
    )
    if (manifest.targetPlatform !== platform || manifest.targetArch !== arch) {
      return undefined
    }
    const artifactPackagePath = join(
      nodeModulesPath,
      "@oai",
      "artifact-tool",
      "package.json"
    )
    const artifactPackageRoot = dirname(artifactPackagePath)
    const artifactPackage = artifactPackageSchema.parse(
      JSON.parse(await readFile(artifactPackagePath, "utf8"))
    )
    if (artifactPackage.version !== manifest.artifactToolVersion)
      return undefined
    const artifactEntryPath = resolve(
      artifactPackageRoot,
      artifactPackage.exports["."]
    )
    const entryFromPackage = relative(artifactPackageRoot, artifactEntryPath)
    if (
      entryFromPackage === ".." ||
      entryFromPackage.startsWith(`..${sep}`) ||
      isAbsolute(entryFromPackage)
    ) {
      return undefined
    }
    const binaryPaths = [
      join(dependencies, "bin", "override"),
      join(dependencies, "bin", "fallback"),
      ...(platform === "win32"
        ? [join(dependencies, "python"), join(dependencies, "node")]
        : [
            join(dependencies, "python", "bin"),
            join(dependencies, "node", "bin"),
          ]),
    ]
    const nativeExecutables = ["pdfinfo", "pdftoppm", "soffice"].map((name) =>
      join(binaryPaths[0]!, platform === "win32" ? `${name}.exe` : name)
    )
    const pluginRoot = join(
      rootPath,
      "plugins",
      "openai-primary-runtime",
      "plugins"
    )
    const skillRoots = artifactPluginNames.map((name) => ({
      id: `artifact-runtime-${name}`,
      name: `Artifact runtime ${name}`,
      path: join(pluginRoot, name, "skills"),
    }))
    await Promise.all([
      access(manifestPath, constants.R_OK),
      access(nodeExecutable, constants.R_OK | constants.X_OK),
      access(nodeModulesPath, constants.R_OK | constants.X_OK),
      access(artifactPackagePath, constants.R_OK),
      access(artifactEntryPath, constants.R_OK),
      access(pythonExecutable, constants.R_OK | constants.X_OK),
      ...binaryPaths.map((path) =>
        access(path, constants.R_OK | constants.X_OK)
      ),
      ...nativeExecutables.map((path) =>
        access(path, constants.R_OK | constants.X_OK)
      ),
      ...artifactPluginNames.flatMap((name) => [
        access(
          join(pluginRoot, name, ".codex-plugin", "plugin.json"),
          constants.R_OK
        ),
        access(
          join(pluginRoot, name, "skills", name, "SKILL.md"),
          constants.R_OK
        ),
      ]),
    ])
    const [nodeVersionResult, pythonVersionResult] = await Promise.all([
      execFileAsync(nodeExecutable, ["--version"], {
        timeout: runtimeProbeTimeoutMs,
      }),
      execFileAsync(pythonExecutable, ["--version"], {
        timeout: runtimeProbeTimeoutMs,
      }),
    ])
    const nodeVersion =
      nodeVersionResult.stdout.trim() || nodeVersionResult.stderr.trim()
    const pythonVersion =
      pythonVersionResult.stdout.trim() || pythonVersionResult.stderr.trim()
    if (
      nodeVersion !== manifest.nodeVersion ||
      pythonVersion !== `Python ${manifest.pythonVersion}`
    ) {
      return undefined
    }
    await execFileAsync(
      nodeExecutable,
      [
        "--input-type=module",
        "--eval",
        "await import(process.argv[1])",
        pathToFileURL(artifactEntryPath).href,
      ],
      { timeout: runtimeProbeTimeoutMs }
    )
    return {
      dependencies: {
        rootPath,
        nodeExecutable,
        nodeModulesPath,
        pythonExecutable,
        binaryPaths,
        versions: {
          bundle: manifest.bundleVersion,
          artifactTool: manifest.artifactToolVersion,
          node: manifest.nodeVersion,
          python: manifest.pythonVersion,
        },
      },
      skillRoots,
    }
  } catch {
    return undefined
  }
}
