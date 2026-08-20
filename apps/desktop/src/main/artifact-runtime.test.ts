import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { discoverArtifactRuntime } from "./artifact-runtime.js"

const temporaryRoots: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true }))
  )
})

describe("artifact runtime discovery", () => {
  it("resolves the runtime declared by the Codex marketplace", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "deskto-artifacts-"))
    temporaryRoots.push(temporaryRoot)
    const runtimeRoot = join(temporaryRoot, "runtime")
    const marketplace = join(runtimeRoot, "plugins", "openai-primary-runtime")
    const configPath = join(temporaryRoot, "config.toml")
    await createRuntime(runtimeRoot)
    await mkdir(marketplace, { recursive: true })
    await writeFile(
      configPath,
      `[marketplaces.openai-primary-runtime]\nsource_type = "local"\nsource = ${JSON.stringify(marketplace)}\n`
    )

    const result = await discoverArtifactRuntime({
      configPath,
      cacheRoot: join(temporaryRoot, "empty-cache"),
    })

    expect(result?.dependencies).toMatchObject({
      rootPath: runtimeRoot,
      versions: { artifactTool: "2.8.39", bundle: "26.805.11740" },
    })
    expect(result?.dependencies.nodeModulesPath).toBe(
      join(runtimeRoot, "dependencies", "node", "node_modules")
    )
    expect(result?.skillRoots.map((root) => root.id)).toEqual([
      "artifact-runtime-documents",
      "artifact-runtime-pdf",
      "artifact-runtime-presentations",
      "artifact-runtime-spreadsheets",
    ])
  })

  it("does not advertise an incomplete runtime", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "deskto-artifacts-"))
    temporaryRoots.push(temporaryRoot)
    const runtimeRoot = join(temporaryRoot, "runtime")
    await mkdir(runtimeRoot, { recursive: true })
    await writeFile(
      join(runtimeRoot, "runtime.json"),
      JSON.stringify(runtimeManifest())
    )

    await expect(
      discoverArtifactRuntime({
        explicitRoot: runtimeRoot,
        configPath: join(temporaryRoot, "missing.toml"),
        cacheRoot: join(temporaryRoot, "empty-cache"),
      })
    ).resolves.toBeUndefined()
  })

  it.runIf(process.platform !== "win32")(
    "does not advertise a runtime with non-executable tools",
    async () => {
      const temporaryRoot = await mkdtemp(join(tmpdir(), "deskto-artifacts-"))
      temporaryRoots.push(temporaryRoot)
      const runtimeRoot = join(temporaryRoot, "runtime")
      await createRuntime(runtimeRoot)
      await chmod(
        join(runtimeRoot, "dependencies", "node", "bin", "node"),
        0o600
      )

      await expect(
        discoverArtifactRuntime({
          explicitRoot: runtimeRoot,
          configPath: join(temporaryRoot, "missing.toml"),
          cacheRoot: join(temporaryRoot, "empty-cache"),
        })
      ).resolves.toBeUndefined()
    }
  )

  it.runIf(process.platform !== "win32")(
    "does not advertise a runtime whose executable cannot start",
    async () => {
      const temporaryRoot = await mkdtemp(join(tmpdir(), "deskto-artifacts-"))
      temporaryRoots.push(temporaryRoot)
      const runtimeRoot = join(temporaryRoot, "runtime")
      await createRuntime(runtimeRoot)
      await writeFile(
        join(runtimeRoot, "dependencies", "node", "bin", "node"),
        "#!/definitely/missing/interpreter\n"
      )

      await expect(
        discoverArtifactRuntime({
          explicitRoot: runtimeRoot,
          configPath: join(temporaryRoot, "missing.toml"),
          cacheRoot: join(temporaryRoot, "empty-cache"),
        })
      ).resolves.toBeUndefined()
    }
  )

  it("rejects a runtime built for another platform", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "deskto-artifacts-"))
    temporaryRoots.push(temporaryRoot)
    const runtimeRoot = join(temporaryRoot, "runtime")
    await createRuntime(runtimeRoot, {
      targetPlatform: process.platform === "darwin" ? "linux" : "darwin",
    })

    await expect(
      discoverArtifactRuntime({
        explicitRoot: runtimeRoot,
        configPath: join(temporaryRoot, "missing.toml"),
        cacheRoot: join(temporaryRoot, "empty-cache"),
      })
    ).resolves.toBeUndefined()
  })

  it("rejects an artifact package whose root export escapes the package", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "deskto-artifacts-"))
    temporaryRoots.push(temporaryRoot)
    const runtimeRoot = join(temporaryRoot, "runtime")
    await createRuntime(runtimeRoot)
    await writeFile(
      join(
        runtimeRoot,
        "dependencies",
        "node",
        "node_modules",
        "@oai",
        "artifact-tool",
        "package.json"
      ),
      JSON.stringify({
        name: "@oai/artifact-tool",
        version: "2.8.39",
        exports: { ".": "../outside.mjs" },
      })
    )

    await expect(
      discoverArtifactRuntime({
        explicitRoot: runtimeRoot,
        configPath: join(temporaryRoot, "missing.toml"),
        cacheRoot: join(temporaryRoot, "empty-cache"),
      })
    ).resolves.toBeUndefined()
  })

  it("reads marketplace configuration from CODEX_HOME", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "deskto-artifacts-"))
    temporaryRoots.push(temporaryRoot)
    const runtimeRoot = join(temporaryRoot, "runtime")
    const codexHome = join(temporaryRoot, "custom-codex")
    const marketplace = join(runtimeRoot, "plugins", "openai-primary-runtime")
    await createRuntime(runtimeRoot)
    await mkdir(codexHome, { recursive: true })
    await writeFile(
      join(codexHome, "config.toml"),
      `[marketplaces.openai-primary-runtime]\nsource = ${JSON.stringify(marketplace)}\n`
    )
    vi.stubEnv("CODEX_HOME", codexHome)

    const result = await discoverArtifactRuntime({
      cacheRoot: join(temporaryRoot, "empty-cache"),
    })

    expect(result?.dependencies.rootPath).toBe(runtimeRoot)
  })

  it("resolves the Windows executable layout", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "deskto-artifacts-"))
    temporaryRoots.push(temporaryRoot)
    const runtimeRoot = join(temporaryRoot, "runtime")
    await createRuntime(runtimeRoot, {
      platform: "win32",
      arch: "x64",
      targetPlatform: "win32",
      targetArch: "x64",
    })

    const result = await discoverArtifactRuntime({
      explicitRoot: runtimeRoot,
      configPath: join(temporaryRoot, "missing.toml"),
      cacheRoot: join(temporaryRoot, "empty-cache"),
      platform: "win32",
      arch: "x64",
    })

    expect(result?.dependencies.nodeExecutable).toBe(
      join(runtimeRoot, "dependencies", "node", "node.exe")
    )
    expect(result?.dependencies.pythonExecutable).toBe(
      join(runtimeRoot, "dependencies", "python", "python.exe")
    )
  })
})

function runtimeManifest(overrides: Record<string, string> = {}) {
  return {
    artifactToolVersion: "2.8.39",
    bundleVersion: "26.805.11740",
    nodeVersion: "v24.14.0",
    pythonVersion: "3.12.13",
    targetArch: process.arch,
    targetPlatform: process.platform,
    ...overrides,
  }
}

type RuntimeFixtureOptions = {
  platform?: NodeJS.Platform
  arch?: string
  targetPlatform?: string
  targetArch?: string
}

async function createRuntime(
  runtimeRoot: string,
  options: RuntimeFixtureOptions = {}
): Promise<void> {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const dependencies = join(runtimeRoot, "dependencies")
  const nodeDirectory =
    platform === "win32"
      ? join(dependencies, "node")
      : join(dependencies, "node", "bin")
  const pythonDirectory =
    platform === "win32"
      ? join(dependencies, "python")
      : join(dependencies, "python", "bin")
  const pluginRoot = join(
    runtimeRoot,
    "plugins",
    "openai-primary-runtime",
    "plugins"
  )
  const pluginNames = ["documents", "pdf", "presentations", "spreadsheets"]
  const executableName = (name: string) =>
    platform === "win32" ? `${name}.exe` : name
  const executableBody = "#!/bin/sh\nexit 0\n"
  const paths = [
    nodeDirectory,
    join(dependencies, "node", "node_modules", "@oai", "artifact-tool"),
    join(dependencies, "node", "node_modules", "@oai", "artifact-tool", "dist"),
    pythonDirectory,
    join(dependencies, "bin", "override"),
    join(dependencies, "bin", "fallback"),
    ...pluginNames.flatMap((name) => [
      join(pluginRoot, name, ".codex-plugin"),
      join(pluginRoot, name, "skills", name),
    ]),
  ]
  await Promise.all(paths.map((path) => mkdir(path, { recursive: true })))
  await Promise.all([
    writeFile(
      join(runtimeRoot, "runtime.json"),
      JSON.stringify(
        runtimeManifest({
          targetArch: options.targetArch ?? arch,
          targetPlatform: options.targetPlatform ?? platform,
        })
      )
    ),
    writeFile(
      join(nodeDirectory, platform === "win32" ? "node.exe" : "node"),
      executableBody
    ),
    writeFile(
      join(
        dependencies,
        "node",
        "node_modules",
        "@oai",
        "artifact-tool",
        "package.json"
      ),
      JSON.stringify({
        name: "@oai/artifact-tool",
        version: "2.8.39",
        exports: { ".": "./dist/artifact_tool.mjs" },
      })
    ),
    writeFile(
      join(
        dependencies,
        "node",
        "node_modules",
        "@oai",
        "artifact-tool",
        "dist",
        "artifact_tool.mjs"
      ),
      "export {}\n"
    ),
    writeFile(
      join(pythonDirectory, platform === "win32" ? "python.exe" : "python3"),
      executableBody
    ),
    ...["pdfinfo", "pdftoppm", "soffice"].map((name) =>
      writeFile(
        join(dependencies, "bin", "override", executableName(name)),
        executableBody
      )
    ),
    ...pluginNames.flatMap((name) => [
      writeFile(join(pluginRoot, name, ".codex-plugin", "plugin.json"), "{}"),
      writeFile(
        join(pluginRoot, name, "skills", name, "SKILL.md"),
        "# Skill\n"
      ),
    ]),
  ])
  await Promise.all([
    chmod(
      join(nodeDirectory, platform === "win32" ? "node.exe" : "node"),
      0o700
    ),
    chmod(
      join(pythonDirectory, platform === "win32" ? "python.exe" : "python3"),
      0o700
    ),
    ...["pdfinfo", "pdftoppm", "soffice"].map((name) =>
      chmod(join(dependencies, "bin", "override", executableName(name)), 0o700)
    ),
  ])
}
