import {
  chmod,
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
  it("moves into an existing empty folder when rename cannot replace it", async () => {
    const root = await mkdtemp(join(tmpdir(), "deskto-project-move-"))
    directories.push(root)
    const source = join(root, "projects", "project-1")
    const destination = join(root, "selected-folder")
    await mkdir(source, { recursive: true })
    await mkdir(destination)
    await chmod(source, 0o700)
    await chmod(destination, 0o750)
    await writeFile(join(source, "README.md"), "Portable\n")

    const move = await moveProjectDirectory(
      source,
      destination,
      async (from, to) => {
        if (to === destination) {
          const destinationExists = await lstat(destination)
            .then(() => true)
            .catch(() => false)
          if (destinationExists) {
            throw Object.assign(new Error("Destination exists"), {
              code: "EEXIST",
            })
          }
        }
        await rename(from, to)
      }
    )

    await move.finalize()
    await expect(
      readFile(join(destination, "README.md"), "utf8")
    ).resolves.toBe("Portable\n")
    expect((await lstat(destination)).mode & 0o777).toBe(0o750)
    await expect(lstat(source)).rejects.toMatchObject({ code: "ENOENT" })
  })

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
