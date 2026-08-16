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
    const blocked = join(root, "blocked")
    await writeFile(blocked, "not a directory")
    const provisioned = provisionClaudePlugins(
      [{ id: "pack-1", name: "Reviews", path: join(root, "skills") }],
      blocked
    )

    expect(provisioned.plugins).toEqual([])
    expect(provisioned.results[0]).toMatchObject({
      rootId: "pack-1",
      status: "failed",
      method: "plugin-shim",
    })
  })
})

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "deskto-claude-packs-"))
  directories.push(directory)
  return directory
}
