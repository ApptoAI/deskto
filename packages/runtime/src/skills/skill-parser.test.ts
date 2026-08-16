import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { maxSkillFileBytes, parseSkillFile } from "./skill-parser.js"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  )
})

describe("parseSkillFile", () => {
  it("parses YAML strings, multiline descriptions, CRLF, and a BOM", async () => {
    const path = await skillFile(
      '\uFEFF---\r\nname: "release:notes"\r\ndescription: >\r\n  Writes release notes\r\n  from a diff.\r\n---\r\n\r\nDo the work.\r\n'
    )

    const parsed = await parseSkillFile(path)

    expect(parsed).toMatchObject({
      name: "release:notes",
      description: "Writes release notes from a diff.",
      content: expect.stringContaining("Do the work."),
      diagnostics: [],
    })
    expect(parsed.instructionDigest).toMatch(/^[a-f0-9]{64}$/)
  })

  it("preserves content and reports malformed YAML", async () => {
    const path = await skillFile(
      "---\nname: [broken\ndescription: nope\n---\nInstructions"
    )

    const parsed = await parseSkillFile(path)

    expect(parsed.content).toContain("Instructions")
    expect(parsed.name).toBeNull()
    expect(parsed.diagnostics[0]?.code).toBe("frontmatter-invalid")
  })

  it("reports missing metadata without inventing fallbacks", async () => {
    const path = await skillFile(
      '---\nname: 42\ndescription: ""\n---\nInstructions'
    )

    const parsed = await parseSkillFile(path)

    expect(parsed.name).toBeNull()
    expect(parsed.description).toBeNull()
    expect(parsed.diagnostics[0]?.code).toBe("frontmatter-invalid")
  })

  it("distinguishes a missing file from missing frontmatter", async () => {
    const directory = await temporaryDirectory()
    const missing = await parseSkillFile(join(directory, "missing.md"))
    const plainPath = join(directory, "plain.md")
    await writeFile(plainPath, "Instructions only")
    const plain = await parseSkillFile(plainPath)

    expect(missing.diagnostics[0]?.code).toBe("skill-file-missing")
    expect(plain.diagnostics[0]?.code).toBe("frontmatter-missing")
  })

  it("does not read a file above the inventory limit", async () => {
    const directory = await temporaryDirectory()
    const path = join(directory, "SKILL.md")
    await writeFile(path, Buffer.alloc(maxSkillFileBytes + 1, "x"))

    const parsed = await parseSkillFile(path)

    expect(parsed.content).toBeNull()
    expect(parsed.diagnostics[0]?.code).toBe("skill-file-too-large")
  })
})

async function skillFile(content: string): Promise<string> {
  const directory = await temporaryDirectory()
  const path = join(directory, "SKILL.md")
  await writeFile(path, content)
  return path
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "deskto-skill-parser-"))
  directories.push(directory)
  return directory
}
