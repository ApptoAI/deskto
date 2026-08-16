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
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import type { PackContentLimits } from "./pack-digest.js"
import {
  stagePackFolder,
  stagePackZip,
  type MaterializedPack,
  type StagedManagedPack,
} from "./pack-installer.js"
import { writeTestZip } from "./zip-test-helpers.js"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  )
})

async function installPackFolder(
  sourcePath: string,
  managedRootPath: string
): Promise<MaterializedPack> {
  return commitForFilesystemTest(
    await stagePackFolder(sourcePath, managedRootPath)
  )
}

async function installPackZip(
  archivePath: string,
  managedRootPath: string,
  limits?: PackContentLimits
): Promise<MaterializedPack> {
  return commitForFilesystemTest(
    await stagePackZip(archivePath, managedRootPath, limits)
  )
}

async function commitForFilesystemTest(
  staged: StagedManagedPack
): Promise<MaterializedPack> {
  try {
    await staged.commit()
    return staged
  } catch (error) {
    await staged.discard().catch(() => undefined)
    throw error
  }
}

describe("installPackFolder", () => {
  it("creates independent managed copies without overwriting the first", async () => {
    const root = await temporaryDirectory()
    const source = join(root, "source")
    const managed = join(root, "managed")
    await writePack(source, "Initial instructions")

    const first = await installPackFolder(source, managed)
    const second = await installPackFolder(source, managed)
    expect(first.path).not.toBe(second.path)
    expect(first.contentDigest).toBe(second.contentDigest)

    await writeFile(
      join(source, "skills", "draft", "SKILL.md"),
      "Changed instructions"
    )
    expect(
      await readFile(join(first.path, "skills", "draft", "SKILL.md"), "utf8")
    ).toBe("Initial instructions")
  })

  it("rejects symlinks and removes its staging directory", async () => {
    const root = await temporaryDirectory()
    const source = join(root, "source")
    const managed = join(root, "managed")
    await writePack(source, "Instructions")
    await symlink(
      join(source, "skills", "draft", "SKILL.md"),
      join(source, "skills", "draft", "linked.md")
    )

    await expect(installPackFolder(source, managed)).rejects.toMatchObject({
      code: "invalid-pack",
    })
    expect(await readdir(managed)).toEqual([])
  })

  it("does not install a folder already owned by the managed root", async () => {
    const root = await temporaryDirectory()
    const managed = join(root, "managed")
    const source = join(managed, "existing")
    await writePack(source, "Instructions")

    await expect(installPackFolder(source, managed)).rejects.toMatchObject({
      code: "invalid-pack",
    })
  })
})

describe("installPackZip", () => {
  it("installs a Pack stored at the archive root", async () => {
    const root = await temporaryDirectory()
    const archive = join(root, "draft-tools.zip")
    const managed = join(root, "managed")
    await writeTestZip(archive, validZipEntries())

    const installed = await installPackZip(archive, managed)

    expect(installed.name).toBe("Draft tools")
    expect(installed.contentDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(
      await readFile(
        join(installed.path, "skills", "draft", "SKILL.md"),
        "utf8"
      )
    ).toBe("Instructions")
  })

  it("removes one wrapper folder while installing", async () => {
    const root = await temporaryDirectory()
    const archive = join(root, "wrapped.zip")
    const managed = join(root, "managed")
    await writeTestZip(
      archive,
      validZipEntries().map((entry) => ({
        ...entry,
        name: `downloaded-pack/${entry.name}`,
      }))
    )

    const installed = await installPackZip(archive, managed)

    expect(installed.name).toBe("Draft tools")
    expect(await readdir(installed.path)).toEqual(["pack.json", "skills"])
  })

  it.each([
    "../outside.txt",
    "/absolute.txt",
    "C:/windows.txt",
    "skills\\backslash.txt",
    "skills/\0nul.txt",
  ])("rejects an unsafe archive path: %s", async (unsafePath) => {
    const root = await temporaryDirectory()
    const archive = join(root, "unsafe.zip")
    const managed = join(root, "managed")
    await writeTestZip(archive, [
      { name: unsafePath, content: "unsafe" },
      ...validZipEntries(),
    ])

    await expect(installPackZip(archive, managed)).rejects.toMatchObject({
      code: "invalid-pack",
    })
    expect(await readdir(managed)).toEqual([])
  })

  it("rejects symbolic links", async () => {
    const root = await temporaryDirectory()
    const archive = join(root, "symlink.zip")
    const managed = join(root, "managed")
    await writeTestZip(archive, [
      ...validZipEntries(),
      {
        name: "skills/draft/linked.md",
        content: "SKILL.md",
        unixMode: 0o120777,
      },
    ])

    await expect(installPackZip(archive, managed)).rejects.toMatchObject({
      code: "invalid-pack",
    })
    expect(await readdir(managed)).toEqual([])
  })

  it("rejects duplicate paths after normalization", async () => {
    const root = await temporaryDirectory()
    const archive = join(root, "duplicate.zip")
    const managed = join(root, "managed")
    await writeTestZip(archive, [
      ...validZipEntries(),
      { name: "skills/draft/./SKILL.md", content: "Duplicate" },
    ])

    await expect(installPackZip(archive, managed)).rejects.toMatchObject({
      code: "invalid-pack",
    })
    expect(await readdir(managed)).toEqual([])
  })

  it.each([
    {
      label: "per-file size",
      limits: {
        maxDepth: 32,
        maxEntries: 20,
        maxFileBytes: 7,
        maxTotalBytes: 100,
      },
    },
    {
      label: "expanded size",
      limits: {
        maxDepth: 32,
        maxEntries: 20,
        maxFileBytes: 100,
        maxTotalBytes: 9,
      },
    },
    {
      label: "entry count",
      limits: {
        maxDepth: 32,
        maxEntries: 1,
        maxFileBytes: 100,
        maxTotalBytes: 100,
      },
    },
  ])("rejects ZIP bomb limits for $label", async ({ limits }) => {
    const root = await temporaryDirectory()
    const archive = join(root, "oversized.zip")
    const managed = join(root, "managed")
    await writeTestZip(archive, [
      { name: "pack.json", content: "{}" },
      { name: "skills/draft/SKILL.md", content: "12345678" },
    ])

    await expect(
      installPackZip(archive, managed, limits)
    ).rejects.toMatchObject({ code: "invalid-pack" })
    expect(await readdir(managed)).toEqual([])
  })
})

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "deskto-pack-install-"))
  directories.push(directory)
  return directory
}

async function writePack(root: string, instructions: string): Promise<void> {
  await mkdir(join(root, "skills", "draft"), { recursive: true })
  await writeFile(join(root, "pack.json"), '{"name":"Draft tools"}\n')
  await writeFile(join(root, "skills", "draft", "SKILL.md"), instructions)
}

function validZipEntries() {
  return [
    {
      name: "pack.json",
      content: '{"name":"Draft tools"}\n',
      compressed: true,
    },
    {
      name: "skills/draft/SKILL.md",
      content: "Instructions",
      compressed: true,
    },
  ]
}
