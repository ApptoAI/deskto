import * as files from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  defaultPackContentLimits,
  digestPackDirectory,
} from "../packs/pack-digest.js"
import { commitSkillFile } from "./skill-file-commit.js"
import { isSkillRecoveryFileName } from "./skill-identifiers.js"
import { scanSkillSource } from "./skill-scanner.js"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => files.rm(path, { recursive: true, force: true }))
  )
})

async function fixture() {
  const root = await files.mkdtemp(join(tmpdir(), "deskto-skill-save-"))
  directories.push(root)
  const directory = join(root, "review")
  await files.mkdir(directory)
  const path = join(directory, "SKILL.md")
  const expectedContent =
    "---\nname: review\ndescription: Review\n---\nOriginal"
  await files.writeFile(path, expectedContent, { mode: 0o600 })
  return {
    root,
    directory,
    path,
    expectedContent,
    content: expectedContent + " deskto",
    identity: await files.stat(path),
  }
}

async function recoveries(directory: string) {
  return (await files.readdir(directory))
    .filter(isSkillRecoveryFileName)
    .map((name) => join(directory, name))
}

describe("skill file commit", () => {
  it.each(["replacement", "in-place"])(
    "preserves a late external %s instead of overwriting it",
    async (mode) => {
      const input = await fixture()
      const external = input.expectedContent + " external"
      await expect(
        commitSkillFile(input, {
          ...files,
          writeFile: async (...args) => {
            await files.writeFile(...args)
            if (mode === "replacement") {
              await files.writeFile(input.path + ".external", external)
              await files.rename(input.path + ".external", input.path)
            } else await files.writeFile(input.path, external)
          },
        })
      ).rejects.toMatchObject({ code: "skill-conflict" })
      expect(await files.readFile(input.path, "utf8")).toBe(external)
      expect(
        await files.readFile((await recoveries(input.directory))[0]!, "utf8")
      ).toBe(external)
    }
  )

  it("keeps an external file recreated between displacement and publication", async () => {
    const input = await fixture()
    const external = input.expectedContent + " recreated"
    await expect(
      commitSkillFile(input, {
        ...files,
        link: async (source, destination) => {
          if (String(source).endsWith(".tmp"))
            await files.writeFile(input.path, external)
          await files.link(source, destination)
        },
      })
    ).rejects.toMatchObject({ code: "skill-conflict" })
    expect(await files.readFile(input.path, "utf8")).toBe(external)
    expect(
      await files.readFile((await recoveries(input.directory))[0]!, "utf8")
    ).toBe(input.expectedContent)
  })

  it("preserves an open descriptor's write during publication and reports conflict", async () => {
    const input = await fixture()
    const writer = await files.open(input.path, "a")
    try {
      await expect(
        commitSkillFile(input, {
          ...files,
          link: async (source, destination) => {
            await files.link(source, destination)
            if (String(source).endsWith(".tmp"))
              await writer.write(" external descriptor")
          },
        })
      ).rejects.toMatchObject({ code: "skill-conflict" })
      expect(await files.readFile(input.path, "utf8")).toBe(input.content)
      expect(
        await files.readFile((await recoveries(input.directory))[0]!, "utf8")
      ).toBe(input.expectedContent + " external descriptor")
    } finally {
      await writer.close()
    }
  })

  it("retains the original inode for writes arriving after a successful save without changing logical digests", async () => {
    const input = await fixture()
    const writer = await files.open(input.path, "a")
    try {
      await commitSkillFile(input)
      const before = await digestPackDirectory(input.directory)
      await writer.write(" later external descriptor")
      expect(await files.readFile(input.path, "utf8")).toBe(input.content)
      expect((await files.stat(input.path)).mode & 0o777).toBe(0o600)
      expect(
        await files.readFile((await recoveries(input.directory))[0]!, "utf8")
      ).toBe(input.expectedContent + " later external descriptor")
      expect(await digestPackDirectory(input.directory)).toEqual(before)
      expect(before.fileCount).toBe(1)
      await expect(
        digestPackDirectory(input.directory, {
          ...defaultPackContentLimits,
          maxEntries: 1,
        })
      ).rejects.toThrow("more than 1 entries")
    } finally {
      await writer.close()
    }
  })

  it("explains recovery when a crash leaves the original displaced", async () => {
    const input = await fixture()
    await files.rename(
      input.path,
      join(
        input.directory,
        ".deskto-skill-11111111-1111-1111-1111-111111111111.recovery"
      )
    )
    const scanned = await scanSkillSource(
      {
        id: "personal",
        kind: "native",
        scopes: ["user"],
        label: "Personal",
        path: input.root,
        harnessIds: ["codex"],
        editable: true,
        provisioning: [],
      },
      { missingIsDiagnostic: true }
    )
    expect(scanned.skills[0]?.occurrence.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "skill-file-missing",
        message: expect.stringContaining(
          "restore the version you want as SKILL.md"
        ),
      })
    )
  })
})
