import { createHash } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { provisionClaudePlugins } from "./claude-packs.js"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  )
})

describe("Claude Pack provisioning", () => {
  it("reports a configured plugin shim", async () => {
    const root = await temporaryDirectory()
    const skills = join(root, "skills")
    const provisioned = provisionClaudePlugins(
      [{ id: "pack-1", name: "Reviews", path: skills }],
      join(root, "shims")
    )

    expect(provisioned.plugins).toHaveLength(1)
    expect(provisioned.results).toEqual([
      {
        rootId: "pack-1",
        rootPath: skills,
        status: "configured",
        method: "plugin-shim",
      },
    ])
  })

  it("reports a failed shim without dropping the other results", async () => {
    const root = await temporaryDirectory()
    const configuredRoot = join(root, "configured-skills")
    const blockedRoot = join(root, "blocked-skills")
    const blockedShim = `blocked-${fingerprint(blockedRoot)}`
    await writeFile(join(root, blockedShim), "not a directory")
    const provisioned = provisionClaudePlugins(
      [
        { id: "pack-1", name: "Configured", path: configuredRoot },
        { id: "pack-2", name: "Blocked", path: blockedRoot },
      ],
      root
    )

    expect(provisioned.plugins).toEqual([
      {
        type: "local",
        path: join(root, `configured-${fingerprint(configuredRoot)}`),
        skipMcpDiscovery: true,
      },
    ])
    expect(provisioned.results).toMatchObject([
      { rootId: "pack-1", status: "configured", method: "plugin-shim" },
      { rootId: "pack-2", status: "failed", method: "plugin-shim" },
    ])
  })
})

function fingerprint(path: string): string {
  return createHash("sha256").update(path).digest("hex").slice(0, 8)
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "deskto-claude-packs-"))
  directories.push(directory)
  return directory
}
