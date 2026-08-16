import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { createRuntime } from "../runtime.js"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  )
})

describe("Pack Runtime operations", () => {
  it("keeps linked files and trashes managed installations", async () => {
    const root = await temporaryDirectory()
    const source = join(root, "source")
    await writePack(source)
    const trashed: string[] = []
    const runtime = createRuntime({
      databasePath: join(root, "runtime.sqlite"),
      packsPath: join(root, "packs"),
      harnesses: [],
      fileActions: {
        trashItem: async (path) => {
          trashed.push(path)
          await rm(path, { recursive: true, force: true })
        },
      },
    })

    const linked = unwrap(
      await runtime.request({ method: "pack.link", params: { path: source } })
    )
    expect(linked.kind).toBe("linked")
    unwrap(
      await runtime.request({
        method: "pack.unlink",
        params: { packId: linked.id },
      })
    )
    expect(existsSync(source)).toBe(true)

    const installed = unwrap(
      await runtime.request({
        method: "pack.install",
        params: { source: { kind: "folder", path: source } },
      })
    )
    expect(installed).toMatchObject({ kind: "managed" })
    expect(installed.receipt?.source.kind).toBe("folder")
    unwrap(
      await runtime.request({
        method: "pack.uninstall",
        params: { packId: installed.id },
      })
    )
    expect(trashed).toEqual([installed.path])
    await runtime.close()
  })

  it("creates and edits a skill through the public Runtime protocol", async () => {
    const root = await temporaryDirectory()
    const runtime = createRuntime({
      databasePath: join(root, "runtime.sqlite"),
      packsPath: join(root, "packs"),
      harnesses: [],
    })
    const pack = unwrap(
      await runtime.request({
        method: "pack.create",
        params: { name: "My Skills" },
      })
    )
    const created = unwrap(
      await runtime.request({
        method: "skill.createManaged",
        params: {
          packId: pack.id,
          name: "Weekly brief",
          description: "Draft a weekly brief",
          instructions: "Summarize this week's work.",
        },
      })
    )
    const directoryName = decodeURIComponent(created.id.split("/")[1]!)
    unwrap(
      await runtime.request({
        method: "skill.updateManaged",
        params: {
          packId: pack.id,
          directoryName,
          name: "Client brief",
          description: "Draft a client brief",
          instructions: "Summarize outcomes and open questions.",
        },
      })
    )

    const content = await readFile(
      join(pack.path, "skills", directoryName, "SKILL.md"),
      "utf8"
    )
    expect(content).toContain("name: Client brief")
    expect(content).toContain("Summarize outcomes and open questions.")
    await runtime.close()
  })
})

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "deskto-pack-runtime-"))
  directories.push(directory)
  return directory
}

async function writePack(root: string): Promise<void> {
  await mkdir(join(root, "skills", "draft"), { recursive: true })
  await writeFile(join(root, "pack.json"), '{"name":"Draft tools"}\n')
  await writeFile(join(root, "skills", "draft", "SKILL.md"), "Instructions")
}

function unwrap<T>(
  response: { ok: true; data: T } | { ok: false; error: unknown }
): T {
  if (!response.ok) throw new Error(JSON.stringify(response.error))
  return response.data
}
