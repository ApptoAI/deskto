import { execFile } from "node:child_process"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import { describe, expect, it } from "vitest"

import { ProjectEntries } from "./project-entries.js"

const execFileAsync = promisify(execFile)

describe("ProjectEntries", () => {
  it("preserves Git paths that require quoting in line-delimited output", async () => {
    const root = await mkdtemp(join(tmpdir(), "openappto-entries-"))
    try {
      const unicodePath = "żółć.md"
      const newlinePath = "line\nbreak.md"
      const stageLikePath = "100644 deadbeef 0\tactual.md"
      await writeFile(join(root, unicodePath), "unicode")
      await writeFile(join(root, newlinePath), "newline")
      await writeFile(join(root, stageLikePath), "untracked")
      await mkdir(join(root, "target"))
      await writeFile(join(root, "target", "file.md"), "target")
      const testSymlink = process.platform !== "win32"
      if (testSymlink) await symlink("target", join(root, "linked"), "dir")
      await execFileAsync("git", ["-C", root, "init", "--quiet"])
      await execFileAsync("git", [
        "-C",
        root,
        "add",
        "--",
        unicodePath,
        newlinePath,
        "target/file.md",
        ...(testSymlink ? ["linked"] : []),
      ])

      const entries = new ProjectEntries()
      await expect(entries.search(root, "żółć", 10)).resolves.toContainEqual({
        path: unicodePath,
        kind: "file",
      })
      await expect(entries.search(root, "line", 10)).resolves.toContainEqual({
        path: newlinePath,
        kind: "file",
      })
      await expect(entries.search(root, "100644", 10)).resolves.toContainEqual({
        path: stageLikePath,
        kind: "file",
      })
      if (testSymlink) {
        await expect(
          entries.search(root, "linked", 10)
        ).resolves.toContainEqual({
          path: "linked",
          kind: "directory",
        })
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
