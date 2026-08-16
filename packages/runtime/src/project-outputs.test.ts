import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { ProjectOutputSweep } from "./project-outputs.js"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  )
})

describe("ProjectOutputSweep", () => {
  it("shares finalization so every caller waits for the same sweep", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deskto-output-sweep-"))
    directories.push(directory)
    await mkdir(join(directory, "project"))
    const produced: string[][] = []
    const sweep = await ProjectOutputSweep.begin(
      join(directory, "project"),
      (paths) => produced.push(paths)
    )
    if (!sweep) throw new Error("expected a project sweep")

    await writeFile(join(directory, "project", "report.csv"), "total\n42\n")
    sweep.request()
    const first = sweep.finish()
    const second = sweep.finish()

    expect(second).toBe(first)
    await first
    expect(produced.flat()).toContain(join(directory, "project", "report.csv"))
  })

  it("does not walk again when no work requested a sweep", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deskto-output-sweep-"))
    directories.push(directory)
    await mkdir(join(directory, "project"))
    const produced: string[][] = []
    const sweep = await ProjectOutputSweep.begin(
      join(directory, "project"),
      (paths) => produced.push(paths)
    )
    if (!sweep) throw new Error("expected a project sweep")

    await writeFile(join(directory, "project", "report.csv"), "total\n42\n")
    await sweep.finish()

    expect(produced).toEqual([])
  })

  it("does not start when the Project root cannot be read", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deskto-output-sweep-"))
    directories.push(directory)

    await expect(
      ProjectOutputSweep.begin(join(directory, "missing"), () => {})
    ).resolves.toBeUndefined()
  })

  it("keeps reporting failures from interrupting finalization", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deskto-output-sweep-"))
    directories.push(directory)
    await mkdir(join(directory, "project"))
    const sweep = await ProjectOutputSweep.begin(
      join(directory, "project"),
      () => {
        throw new Error("capture failed")
      }
    )
    if (!sweep) throw new Error("expected a project sweep")

    await writeFile(join(directory, "project", "report.csv"), "total\n42\n")
    sweep.request()

    await expect(sweep.finish()).resolves.toBeUndefined()
  })
})
