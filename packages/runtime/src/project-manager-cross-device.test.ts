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
  rmdir,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  copyDirectoryContentsNoClobber,
  moveProjectDirectory,
} from "./project-manager.js"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  )
})

describe("cross-device Project relocation", () => {
  it("keeps a destination file that appears before template materialization", async () => {
    const root = await mkdtemp(join(tmpdir(), "deskto-template-copy-"))
    directories.push(root)
    const source = join(root, "staging")
    const destination = join(root, "selected-folder")
    await mkdir(source)
    await mkdir(destination)
    await writeFile(join(source, "README.md"), "Template\n")
    await writeFile(join(destination, "README.md"), "User content\n")

    await expect(
      copyDirectoryContentsNoClobber(source, destination)
    ).rejects.toMatchObject({ code: "EEXIST" })
    await expect(
      readFile(join(destination, "README.md"), "utf8")
    ).resolves.toBe("User content\n")
  })

  it("does not delete a file that replaces a copied template file", async () => {
    const root = await mkdtemp(join(tmpdir(), "deskto-template-copy-"))
    directories.push(root)
    const source = join(root, "staging")
    const destination = join(root, "selected-folder")
    await mkdir(source)
    await mkdir(destination)
    await writeFile(join(source, "README.md"), "Template\n")

    await expect(
      copyDirectoryContentsNoClobber(source, destination, {
        async afterCreate(entry) {
          if (entry.kind !== "file") return
          await rm(entry.path)
          await writeFile(entry.path, "Replacement\n")
        },
      })
    ).rejects.toMatchObject({ code: "project-move-recovery-failed" })
    await expect(
      readFile(join(destination, "README.md"), "utf8")
    ).resolves.toBe("Replacement\n")
  })

  it("does not traverse a directory replaced by a symlink", async () => {
    const root = await mkdtemp(join(tmpdir(), "deskto-template-copy-"))
    directories.push(root)
    const source = join(root, "staging")
    const destination = join(root, "selected-folder")
    const outside = join(root, "outside")
    await mkdir(join(source, "nested"), { recursive: true })
    await mkdir(destination)
    await mkdir(outside)
    await writeFile(join(source, "nested", "README.md"), "Template\n")

    await expect(
      copyDirectoryContentsNoClobber(source, destination, {
        async afterCreate(entry) {
          if (entry.kind !== "directory") return
          await rmdir(entry.path)
          await symlink(outside, entry.path, "dir")
        },
      })
    ).rejects.toMatchObject({ code: "project-move-recovery-failed" })
    expect((await lstat(join(destination, "nested"))).isSymbolicLink()).toBe(
      true
    )
    await expect(lstat(join(outside, "README.md"))).rejects.toMatchObject({
      code: "ENOENT",
    })
  })

  it("restores a selected folder that changes while being claimed", async () => {
    const root = await mkdtemp(join(tmpdir(), "deskto-project-move-"))
    directories.push(root)
    const source = join(root, "projects", "project-1")
    const destination = join(root, "selected-folder")
    await mkdir(source, { recursive: true })
    await mkdir(destination)
    await writeFile(join(source, "README.md"), "Portable\n")

    await expect(
      moveProjectDirectory(source, destination, async (from, to) => {
        await rename(from, to)
        if (from === destination) {
          await writeFile(join(to, "late.txt"), "Keep me\n")
        }
      })
    ).rejects.toMatchObject({ code: "project-folder-not-empty" })

    await expect(readFile(join(destination, "late.txt"), "utf8")).resolves.toBe(
      "Keep me\n"
    )
    await expect(readFile(join(source, "README.md"), "utf8")).resolves.toBe(
      "Portable\n"
    )
  })

  it("surfaces a failed relocation rollback with both paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "deskto-project-move-"))
    directories.push(root)
    const source = join(root, "projects", "project-1")
    const destination = join(root, "selected-folder")
    await mkdir(source, { recursive: true })
    await mkdir(destination)
    let rejectRollback = false
    const move = await moveProjectDirectory(
      source,
      destination,
      async (from, to) => {
        if (rejectRollback && from === destination && to === source) {
          throw Object.assign(new Error("Permission denied"), {
            code: "EACCES",
          })
        }
        await rename(from, to)
      }
    )

    rejectRollback = true
    const rollback = move.rollback()
    await expect(rollback).rejects.toMatchObject({
      code: "project-move-recovery-failed",
      message: expect.stringContaining(source),
    })
    await expect(rollback).rejects.toMatchObject({
      message: expect.stringContaining(destination),
    })
  })

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
