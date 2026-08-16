import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import type { DatabaseSync } from "node:sqlite"

import { afterEach, describe, expect, it, vi } from "vitest"

import { openDatabase } from "../storage/database.js"
import { Packs } from "../storage/packs.js"
import { Workspaces } from "../storage/workspaces.js"
import { PackManager } from "./pack-manager.js"
import { writeTestZip } from "./zip-test-helpers.js"

const directories: string[] = []
const databases: DatabaseSync[] = []

afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  )
})

describe("PackManager", () => {
  it("distinguishes managed installs from links and never deletes linked files", async () => {
    const context = await testContext()
    const source = join(context.root, "source")
    await writePack(source)

    const linked = await context.manager.link(source)
    expect(linked).toMatchObject({
      kind: "linked",
      content_digest: null,
      receipt_json: null,
    })
    context.manager.unlink(linked.id)
    expect(existsSync(source)).toBe(true)

    const installed = await context.manager.installFolder(source)
    expect(installed.kind).toBe("managed")
    expect(installed.path).not.toBe(source)
    expect(installed.content_digest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(JSON.parse(installed.receipt_json ?? "null")).toMatchObject({
      schemaVersion: 1,
      source: { kind: "folder", name: basename(source) },
      contentDigest: installed.content_digest,
    })
  })

  it("records the ZIP source on a managed install", async () => {
    const context = await testContext()
    const archive = join(context.root, "draft-tools.zip")
    await writeTestZip(archive, [
      { name: "pack.json", content: '{"name":"Draft tools"}\n' },
      { name: "skills/draft/SKILL.md", content: "Instructions" },
    ])

    const installed = await context.manager.installZip(archive)

    expect(installed.kind).toBe("managed")
    expect(JSON.parse(installed.receipt_json ?? "null")).toMatchObject({
      schemaVersion: 1,
      source: { kind: "zip", name: "draft-tools.zip" },
      contentDigest: installed.content_digest,
    })
  })

  it("does not treat an existing managed directory as a local link", async () => {
    const context = await testContext()
    const managed = await context.manager.create("Managed")

    await expect(context.manager.link(managed.path)).rejects.toMatchObject({
      code: "invalid-pack-operation",
    })
  })

  it("registers the receipt before committing the staged directory", async () => {
    const context = await testContext()
    const source = join(context.root, "source")
    await writePack(source)
    const add = context.packs.add.bind(context.packs)
    let observedRegisteredStaging = false
    vi.spyOn(context.packs, "add").mockImplementation(
      (name, path, metadata) => {
        expect(existsSync(path)).toBe(false)
        const record = add(name, path, metadata)
        expect(context.packs.get(record.id).receipt_json).not.toBeNull()
        observedRegisteredStaging = true
        return record
      }
    )

    const installed = await context.manager.installFolder(source)

    expect(observedRegisteredStaging).toBe(true)
    expect(existsSync(installed.path)).toBe(true)
  })

  it("rolls back the receipt and staging when the final rename fails", async () => {
    const context = await testContext()
    const source = join(context.root, "source")
    await writePack(source)
    const add = context.packs.add.bind(context.packs)
    let blockedDestination = ""
    vi.spyOn(context.packs, "add").mockImplementation(
      (name, path, metadata) => {
        const record = add(name, path, metadata)
        blockedDestination = path
        mkdirSync(path)
        writeFileSync(join(path, "unrelated.txt"), "keep")
        return record
      }
    )

    await expect(context.manager.installFolder(source)).rejects.toThrow()

    expect(context.packs.findByPath(blockedDestination)).toBeNull()
    expect(
      await readFile(join(blockedDestination, "unrelated.txt"), "utf8")
    ).toBe("keep")
    expect(
      (await readdir(join(context.root, "managed"))).filter((name) =>
        name.startsWith(".install-")
      )
    ).toEqual([])
  })

  it("trashes a managed Pack before deleting its record and attachments", async () => {
    const trashed: string[] = []
    const context = await testContext({
      trashItem: async (path) => {
        trashed.push(path)
        await rm(path, { recursive: true, force: true })
      },
    })
    const pack = await context.manager.create("My Skills")
    context.packs.setAttached("personal", pack.id, true)

    await context.manager.uninstall(pack.id)

    expect(trashed).toEqual([pack.path])
    expect(() => context.packs.get(pack.id)).toThrow("Pack not found")
    expect(context.packs.workspaceIdsFor(pack.id)).toEqual([])
  })

  it("keeps the record when the host cannot move the directory to trash", async () => {
    const context = await testContext({
      trashItem: async () => {
        throw new Error("trash failed")
      },
    })
    const pack = await context.manager.create("Keep me")

    await expect(context.manager.uninstall(pack.id)).rejects.toThrow(
      "trash failed"
    )
    expect(context.packs.get(pack.id).id).toBe(pack.id)
    expect(existsSync(pack.path)).toBe(true)
  })

  it("removes a missing managed Pack record without requiring trash", async () => {
    const context = await testContext()
    const pack = await context.manager.create("Missing")
    await rm(pack.path, { recursive: true })

    await context.manager.uninstall(pack.id)

    expect(() => context.packs.get(pack.id)).toThrow("Pack not found")
  })

  it("creates and updates skills only inside managed Packs", async () => {
    const context = await testContext()
    const pack = await context.manager.create("My Skills")
    const created = await context.manager.createSkill(pack.id, {
      name: "Weekly brief",
      description: "Draft a weekly update",
      instructions: "Summarize the work from this week.",
    })
    const directoryName = decodeURIComponent(created.id.split("/")[1]!)
    const skillPath = join(pack.path, "skills", directoryName, "SKILL.md")
    expect(await readFile(skillPath, "utf8")).toContain(
      "Summarize the work from this week."
    )

    const updated = await context.manager.updateSkill(pack.id, directoryName, {
      name: "Client brief",
      description: "Draft a client update",
      instructions: "Summarize outcomes and open questions.",
    })
    expect(updated.name).toBe("Client brief")
    expect(await readFile(skillPath, "utf8")).toContain(
      "Summarize outcomes and open questions."
    )

    const source = join(context.root, "linked")
    await writePack(source)
    const linked = await context.manager.link(source)
    await expect(
      context.manager.createSkill(linked.id, {
        name: "No",
        description: "No",
        instructions: "No",
      })
    ).rejects.toMatchObject({ code: "invalid-pack-operation" })

    const otherManaged = await context.manager.create("Other Pack")
    await expect(
      context.manager.createSkill(otherManaged.id, {
        name: "No",
        description: "No",
        instructions: "No",
      })
    ).rejects.toMatchObject({ code: "invalid-pack-operation" })
  })

  it.runIf(process.platform !== "win32")(
    "refuses to edit My Skills through a replaced skills symlink",
    async () => {
      const context = await testContext()
      const pack = await context.manager.create("My Skills")
      const outside = join(context.root, "outside")
      await mkdir(outside)
      await rm(join(pack.path, "skills"), { recursive: true })
      await symlink(outside, join(pack.path, "skills"), "dir")

      await expect(
        context.manager.createSkill(pack.id, {
          name: "Escaping",
          description: "Must stay contained",
          instructions: "Do not write outside the Pack.",
        })
      ).rejects.toMatchObject({ code: "invalid-pack-path" })
      expect(await readdir(outside)).toEqual([])
    }
  )
})

describe("legacy Pack ownership", () => {
  it("classifies only direct children of the managed root as managed", async () => {
    const root = await temporaryDirectory()
    const managedRoot = join(root, "managed")
    const managedPath = join(managedRoot, "old-created-pack")
    const linkedPath = join(root, "external-pack")
    await mkdir(managedPath, { recursive: true })
    await mkdir(linkedPath, { recursive: true })
    const database = openDatabase(":memory:")
    databases.push(database)
    const packs = new Packs(database, new Workspaces(database))
    const now = new Date().toISOString()
    const insert = database.prepare(
      "INSERT INTO packs (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    )
    insert.run("managed", "Managed", managedPath, now, now)
    insert.run("linked", "Linked", linkedPath, now, now)

    packs.initializeOwnership(managedRoot)

    expect(packs.get("managed").kind).toBe("managed")
    expect(packs.get("linked").kind).toBe("linked")
  })
})

async function testContext(fileActions?: {
  trashItem(path: string): Promise<void>
}) {
  const root = await temporaryDirectory()
  const database = openDatabase(":memory:")
  databases.push(database)
  const packs = new Packs(database, new Workspaces(database))
  const manager = new PackManager(packs, join(root, "managed"), fileActions)
  return { root, packs, manager }
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "deskto-pack-manager-"))
  directories.push(directory)
  return directory
}

async function writePack(root: string): Promise<void> {
  await mkdir(join(root, "skills", "draft"), { recursive: true })
  await writeFile(join(root, "pack.json"), '{"name":"Draft tools"}\n')
  await writeFile(join(root, "skills", "draft", "SKILL.md"), "Instructions")
}
