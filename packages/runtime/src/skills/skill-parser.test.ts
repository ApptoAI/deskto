import {
  appendFile,
  mkdtemp,
  open,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { maxSkillFileBytes, parseSkillFile } from "./skill-parser.js"

const directories: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
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

    const parsed = await parseSkillFile(path, dirname(path))

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

    const parsed = await parseSkillFile(path, dirname(path))

    expect(parsed.content).toContain("Instructions")
    expect(parsed.name).toBeNull()
    expect(parsed.diagnostics[0]?.code).toBe("frontmatter-invalid")
  })

  it("reports missing metadata without inventing fallbacks", async () => {
    const path = await skillFile(
      '---\nname: 42\ndescription: ""\n---\nInstructions'
    )

    const parsed = await parseSkillFile(path, dirname(path))

    expect(parsed.name).toBeNull()
    expect(parsed.description).toBeNull()
    expect(parsed.diagnostics[0]?.code).toBe("frontmatter-invalid")
  })

  it("distinguishes a missing file from missing frontmatter", async () => {
    const directory = await temporaryDirectory()
    const missing = await parseSkillFile(
      join(directory, "missing.md"),
      directory
    )
    const plainPath = join(directory, "plain.md")
    await writeFile(plainPath, "Instructions only")
    const plain = await parseSkillFile(plainPath, directory)

    expect(missing.diagnostics[0]?.code).toBe("skill-file-missing")
    expect(plain.diagnostics[0]?.code).toBe("frontmatter-missing")
  })

  it("does not read a file above the inventory limit", async () => {
    const directory = await temporaryDirectory()
    const path = join(directory, "SKILL.md")
    await writeFile(path, Buffer.alloc(maxSkillFileBytes + 1, "x"))

    const parsed = await parseSkillFile(path, directory)

    expect(parsed.content).toBeNull()
    expect(parsed.diagnostics[0]?.code).toBe("skill-file-too-large")
  })

  it("reads content appended after the file is opened", async () => {
    const initial = "---\nname: grow\ndescription: Growing skill\n---\nStart"
    const appended = " and finish"
    const path = await skillFile(initial)
    const probe = await open(path, "r")
    type Read = (
      buffer: Buffer,
      offset: number,
      length: number,
      position: number
    ) => Promise<{ bytesRead: number; buffer: Buffer }>
    // SAFETY: Node FileHandle instances share this read prototype, and this
    // test calls the same overload that parseSkillFile uses below.
    const prototype = Object.getPrototypeOf(probe) as { read: Read }
    const read = prototype.read
    await probe.close()
    let grew = false
    vi.spyOn(prototype, "read").mockImplementation(async function (
      this: { read: Read },
      buffer,
      offset,
      length,
      position
    ) {
      const result = await read.call(this, buffer, offset, length, position)
      if (!grew && result.bytesRead > 0) {
        grew = true
        await appendFile(path, appended)
      }
      return result
    })

    const parsed = await parseSkillFile(path, dirname(path))

    expect(parsed.content).toBe(initial + appended)
    expect(parsed.diagnostics).toEqual([])
  })

  it.runIf(process.platform !== "win32")(
    "does not read a SKILL.md symlink outside its source",
    async () => {
      const root = await temporaryDirectory()
      const outside = await temporaryDirectory()
      const target = join(outside, "secret.md")
      const path = join(root, "SKILL.md")
      await writeFile(target, "private content")
      await symlink(target, path)

      const parsed = await parseSkillFile(path, root)

      expect(parsed.content).toBeNull()
      expect(parsed.diagnostics[0]?.code).toBe("skill-file-unreadable")
    }
  )
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
