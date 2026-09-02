import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { mkdir, readdir, rename, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  commitBrowserDownload,
  stageBrowserDownload,
} from "./browser-download.js"
import { prepareBrowserDownloadDirectory } from "./browser-settings.js"

const temporaryDirectories: string[] = []

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

async function stage(content: string): Promise<string> {
  const staging = temporaryDirectory("deskto-staging-")
  const staged = stageBrowserDownload(staging)
  await writeFile(staged, content)
  return staged
}

describe("browser download commit", () => {
  it("moves a completed download under the project's download folder", async () => {
    const project = temporaryDirectory("deskto-project-")
    const staged = await stage("report body")
    expect(prepareBrowserDownloadDirectory(project, "downloads")).toBeDefined()

    const result = await commitBrowserDownload({
      stagedPath: staged,
      projectPath: project,
      downloadFolder: "downloads",
      fileName: "report.pdf",
    })

    expect(result).toEqual({
      path: path.join(project, "downloads", "report.pdf"),
    })
    expect(readFileSync(path.join(project, "downloads", "report.pdf"), "utf8")).toBe(
      "report body"
    )
    expect(existsSync(staged)).toBe(false)
  })

  it("never overwrites an existing file", async () => {
    const project = temporaryDirectory("deskto-project-")
    await mkdir(path.join(project, "downloads"))
    await writeFile(path.join(project, "downloads", "report.pdf"), "original")
    const staged = await stage("second")

    const result = await commitBrowserDownload({
      stagedPath: staged,
      projectPath: project,
      downloadFolder: "downloads",
      fileName: "report.pdf",
    })

    expect(result).toEqual({
      path: path.join(project, "downloads", "report (2).pdf"),
    })
    expect(readFileSync(path.join(project, "downloads", "report.pdf"), "utf8")).toBe(
      "original"
    )
  })

  it("refuses the write when the folder became a symlink after validation", async () => {
    const project = temporaryDirectory("deskto-project-")
    const outside = temporaryDirectory("deskto-outside-")
    const staged = await stage("secret payload")
    const directory = prepareBrowserDownloadDirectory(project, "downloads")
    expect(directory).toBe(path.join(project, "downloads"))

    // The swap a hostile page would race for: the validated folder is
    // replaced by a link that points outside the project.
    await rename(directory ?? "", path.join(project, "downloads.moved"))
    await symlink(outside, directory ?? "", "dir")

    const result = await commitBrowserDownload({
      stagedPath: staged,
      projectPath: project,
      downloadFolder: "downloads",
      fileName: "report.pdf",
    })

    expect(result).toHaveProperty("refused")
    expect(await readdir(outside)).toEqual([])
    expect(existsSync(staged)).toBe(false)
  })

  it("refuses a destination name that is a symlink", async () => {
    const project = temporaryDirectory("deskto-project-")
    const outside = temporaryDirectory("deskto-outside-")
    const victim = path.join(outside, "victim.txt")
    await writeFile(victim, "keep me")
    await mkdir(path.join(project, "downloads"))
    await symlink(victim, path.join(project, "downloads", "report.pdf"))
    const staged = await stage("clobber")

    const result = await commitBrowserDownload({
      stagedPath: staged,
      projectPath: project,
      downloadFolder: "downloads",
      fileName: "report.pdf",
    })

    expect(result).toEqual({
      path: path.join(project, "downloads", "report (2).pdf"),
    })
    expect(readFileSync(victim, "utf8")).toBe("keep me")
  })

  it("refuses when the project itself is missing or the folder escapes it", async () => {
    const project = temporaryDirectory("deskto-project-")
    const staged = await stage("body")

    expect(
      await commitBrowserDownload({
        stagedPath: staged,
        projectPath: project,
        downloadFolder: "../elsewhere",
        fileName: "report.pdf",
      })
    ).toHaveProperty("refused")
    expect(
      await commitBrowserDownload({
        stagedPath: staged,
        projectPath: undefined,
        downloadFolder: "downloads",
        fileName: "report.pdf",
      })
    ).toHaveProperty("refused")
    expect(existsSync(staged)).toBe(false)
  })
})
