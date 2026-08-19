import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { moveProjectDirectory } from "./project-manager.js"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  )
})

describe("cross-device Project relocation", () => {
  it("rejects the move without changing either folder", async () => {
    const root = await mkdtemp(join(tmpdir(), "deskto-project-move-"))
    directories.push(root)
    const source = join(root, "projects", "project-1")
    const destination = join(root, "external-volume")
    await mkdir(source, { recursive: true })
    await mkdir(destination)
    await writeFile(join(source, "README.md"), "Portable\n")
    const resolvedDestination = await realpath(destination)
    const destinationBefore = await lstat(destination)

    await expect(
      moveProjectDirectory(source, resolvedDestination, async (from, to) => {
        if (from === source && to === resolvedDestination) {
          throw Object.assign(new Error("Cross-device link"), { code: "EXDEV" })
        }
        await rename(from, to)
      })
    ).rejects.toMatchObject({ code: "project-move-cross-device" })

    await expect(readFile(join(source, "README.md"), "utf8")).resolves.toBe(
      "Portable\n"
    )
    await expect(readdir(destination)).resolves.toEqual([])
    const destinationAfter = await lstat(destination)
    expect({
      dev: destinationAfter.dev,
      ino: destinationAfter.ino,
      mode: destinationAfter.mode,
    }).toEqual({
      dev: destinationBefore.dev,
      ino: destinationBefore.ino,
      mode: destinationBefore.mode,
    })
  })
})
