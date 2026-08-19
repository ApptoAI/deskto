import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  listSafeProjectTemplateFiles,
  materializeTemplateFiles,
} from "./project-template-files.js"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  )
})

describe("Project template files", () => {
  it("does not offer common credential files", async () => {
    const root = await temporaryDirectory()
    await writeFile(join(root, "README.md"), "Starter\n")
    await writeFile(join(root, ".npmrc"), "//registry:_authToken=value\n")
    await writeFile(join(root, "service-account.json"), "{}\n")

    await expect(listSafeProjectTemplateFiles(root)).resolves.toEqual([
      { path: "README.md", sizeBytes: 8 },
    ])
  })

  it("rejects a template directory outside its Pack", async () => {
    const root = await temporaryDirectory()
    const pack = join(root, "pack")
    const outsideTemplate = join(root, "outside-template")
    await mkdir(pack)
    await mkdir(join(outsideTemplate, "files"), { recursive: true })

    await expect(
      materializeTemplateFiles(
        { path: outsideTemplate, packRoot: pack },
        join(root, "destination")
      )
    ).rejects.toMatchObject({ code: "invalid-template" })
  })

  it("rejects a files directory that redirects outside its template", async () => {
    const root = await temporaryDirectory()
    const pack = join(root, "pack")
    const template = join(pack, "templates", "redirected")
    const outside = join(root, "outside")
    await mkdir(template, { recursive: true })
    await mkdir(outside)
    await writeFile(join(outside, "README.md"), "Not part of the Pack\n")
    await symlink(outside, join(template, "files"), "dir")

    await expect(
      materializeTemplateFiles(
        { path: template, packRoot: pack },
        join(root, "destination")
      )
    ).rejects.toMatchObject({ code: "invalid-template" })
  })

  it("caps template directory depth", async () => {
    const root = await temporaryDirectory()
    const pack = join(root, "pack")
    const template = join(pack, "templates", "deep")
    let directory = join(template, "files")
    await mkdir(directory, { recursive: true })
    for (let depth = 0; depth < 34; depth += 1) {
      directory = join(directory, `level-${depth}`)
      await mkdir(directory)
    }
    await writeFile(join(directory, "README.md"), "Too deep\n")

    await expect(
      materializeTemplateFiles(
        { path: template, packRoot: pack },
        join(root, "destination")
      )
    ).rejects.toMatchObject({ code: "invalid-template" })
  })
})

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "deskto-template-files-"))
  directories.push(directory)
  return directory
}
