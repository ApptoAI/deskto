import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { scanSkillSource, type SkillSourceInput } from "./skill-scanner.js"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  )
})

describe("scanSkillSource", () => {
  it("keeps duplicates and invalid sibling directories", async () => {
    const root = await temporaryDirectory()
    await writeSkill(root, "one", "duplicate", "First")
    await writeSkill(root, "two", "duplicate", "Second")
    await mkdir(join(root, "missing"))
    await writeFile(join(root, "not-a-skill.md"), "ignored")

    const scanned = await scanSkillSource(source(root), {
      missingIsDiagnostic: false,
    })

    expect(scanned.skills).toHaveLength(3)
    expect(
      scanned.skills.filter(({ occurrence }) => occurrence.name === "duplicate")
    ).toHaveLength(2)
    expect(
      scanned.skills.find(
        ({ occurrence }) => occurrence.directoryName === "missing"
      )?.occurrence.diagnostics[0]?.code
    ).toBe("skill-file-missing")
  })

  it("reports optional resource directories", async () => {
    const root = await temporaryDirectory()
    await writeSkill(root, "review", "review", "Review changes")
    await Promise.all([
      mkdir(join(root, "review", "scripts")),
      mkdir(join(root, "review", "references")),
      mkdir(join(root, "review", "assets")),
    ])

    const scanned = await scanSkillSource(source(root), {
      missingIsDiagnostic: false,
    })

    expect(scanned.skills[0]?.occurrence).toMatchObject({
      hasScripts: true,
      hasReferences: true,
      hasAssets: true,
    })
  })

  it.runIf(process.platform !== "win32")(
    "keeps an external symlink visible without reading outside the source",
    async () => {
      const root = await temporaryDirectory()
      const targetRoot = await temporaryDirectory()
      await writeSkill(targetRoot, "target", "linked", "Linked skill")
      await symlink(join(targetRoot, "target"), join(root, "linked"), "dir")

      const scanned = await scanSkillSource(source(root), {
        missingIsDiagnostic: false,
      })

      expect(scanned.skills[0]?.occurrence).toMatchObject({
        directoryPath: join(root, "linked"),
        resolvedDirectoryPath: await realpath(join(targetRoot, "target")),
        name: null,
        diagnostics: [
          expect.objectContaining({ code: "skill-path-outside-source" }),
        ],
      })
      expect(scanned.skills[0]?.content).toBeNull()
    }
  )

  it.runIf(process.platform !== "win32")(
    "does not read an external SKILL.md symlink",
    async () => {
      const root = await temporaryDirectory()
      const outside = await temporaryDirectory()
      const skill = join(root, "linked-file")
      const target = join(outside, "secret.md")
      await mkdir(skill)
      await writeFile(target, "private content")
      await symlink(target, join(skill, "SKILL.md"))

      const scanned = await scanSkillSource(source(root), {
        missingIsDiagnostic: false,
      })

      expect(scanned.skills[0]?.content).toBeNull()
      expect(scanned.skills[0]?.occurrence.diagnostics[0]?.code).toBe(
        "skill-file-unreadable"
      )
    }
  )

  it.runIf(process.platform !== "win32")(
    "reports a broken skill symlink inside a resolved source",
    async () => {
      const root = await temporaryDirectory()
      await symlink(join(root, "missing"), join(root, "broken"), "dir")

      const scanned = await scanSkillSource(source(root), {
        missingIsDiagnostic: false,
      })

      expect(scanned.skills[0]?.occurrence).toMatchObject({
        directoryName: "broken",
        diagnostics: [
          expect.objectContaining({ code: "skill-file-missing" }),
          expect.anything(),
        ],
      })
    }
  )

  it("changes the content digest when a resource changes", async () => {
    const root = await temporaryDirectory()
    await writeSkill(root, "review", "review", "Review changes")
    const reference = join(root, "review", "references", "rules.md")
    await mkdir(join(root, "review", "references"))
    await writeFile(reference, "First version")

    const before = await scanSkillSource(source(root), {
      missingIsDiagnostic: false,
    })
    await writeFile(reference, "Second version")
    const after = await scanSkillSource(source(root), {
      missingIsDiagnostic: false,
    })

    expect(before.skills[0]?.occurrence.contentDigest).toMatch(/^sha256:/)
    expect(after.skills[0]?.occurrence.contentDigest).not.toBe(
      before.skills[0]?.occurrence.contentDigest
    )
  })

  it("omits a missing optional root and reports a required root", async () => {
    const parent = await temporaryDirectory()
    const missing = join(parent, "missing")

    const optional = await scanSkillSource(source(missing), {
      missingIsDiagnostic: false,
    })
    const required = await scanSkillSource(source(missing), {
      missingIsDiagnostic: true,
    })

    expect(optional.source).toBeNull()
    expect(required.source?.diagnostics[0]?.code).toBe("source-not-directory")
  })

  it("reports an optional root that exists as a file", async () => {
    const parent = await temporaryDirectory()
    const path = join(parent, "skills")
    await writeFile(path, "not a directory")

    const scanned = await scanSkillSource(source(path), {
      missingIsDiagnostic: false,
    })

    expect(scanned.source?.diagnostics[0]).toMatchObject({
      code: "source-not-directory",
      message: "Skill source is not a directory",
    })
  })
})

function source(path: string): SkillSourceInput {
  return {
    id: "source-1",
    kind: "native",
    scopes: ["user"],
    label: "Test skills",
    path,
    harnessIds: ["test"],
    editable: false,
    provisioning: [],
  }
}

async function writeSkill(
  root: string,
  directoryName: string,
  name: string,
  description: string
): Promise<void> {
  const directory = join(root, directoryName)
  await mkdir(directory, { recursive: true })
  await writeFile(
    join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\nInstructions\n`
  )
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "deskto-skill-scanner-"))
  directories.push(directory)
  return directory
}
