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
    const sweep = await ProjectOutputSweep.begin(
      join(directory, "project"),
      () => {}
    )
    if (!sweep) throw new Error("expected a project sweep")

    await writeFile(join(directory, "project", "report.csv"), "total\n42\n")
    sweep.request()
    const first = sweep.finish()
    const second = sweep.finish()

    expect(second).toBe(first)
    await first
  })
})
