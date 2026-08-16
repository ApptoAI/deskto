import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { digestPackDirectory } from "./pack-digest.js"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  )
})

describe("digestPackDirectory", () => {
  it("is stable across locations and changes when file content changes", async () => {
    const first = await temporaryDirectory()
    const second = await temporaryDirectory()
    await writeTree(first, "First")
    await writeTree(second, "First")

    const firstDigest = await digestPackDirectory(first)
    expect(await digestPackDirectory(second)).toEqual(firstDigest)

    await writeFile(join(second, "skills", "draft", "SKILL.md"), "Second")
    expect((await digestPackDirectory(second)).contentDigest).not.toBe(
      firstDigest.contentDigest
    )
  })

  it("rejects symlinks and configured size limits", async () => {
    const directory = await temporaryDirectory()
    await writeTree(directory, "content")
    await symlink(
      join(directory, "skills", "draft", "SKILL.md"),
      join(directory, "skills", "draft", "linked.md")
    )

    await expect(digestPackDirectory(directory)).rejects.toMatchObject({
      code: "invalid-pack",
    })

    await rm(join(directory, "skills", "draft", "linked.md"))
    await expect(
      digestPackDirectory(directory, {
        maxEntries: 10,
        maxFileBytes: 3,
        maxTotalBytes: 10,
        maxDepth: 3,
      })
    ).rejects.toMatchObject({ code: "invalid-pack" })
  })

  it("maps an unreadable root to an invalid Pack error", async () => {
    const root = await temporaryDirectory()

    await expect(
      digestPackDirectory(join(root, "missing"))
    ).rejects.toMatchObject({ code: "invalid-pack" })
  })
})

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "deskto-pack-digest-"))
  directories.push(directory)
  return directory
}

async function writeTree(root: string, content: string): Promise<void> {
  await mkdir(join(root, "skills", "draft"), { recursive: true })
  await writeFile(join(root, "pack.json"), '{"name":"Drafts"}\n')
  await writeFile(join(root, "skills", "draft", "SKILL.md"), content)
}
