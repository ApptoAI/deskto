import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { configureCliPath } from "./cli-path.js"

const originalPath = process.env.PATH
const temporaryDirectories: string[] = []

afterEach(async () => {
  process.env.PATH = originalPath
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe("CLI PATH discovery", () => {
  it("finds native installs and version-manager bins without a shell", async () => {
    const homeDirectory = await mkdtemp(path.join(tmpdir(), "deskto-cli-path-"))
    temporaryDirectories.push(homeDirectory)
    await Promise.all([
      mkdir(path.join(homeDirectory, ".local/bin"), { recursive: true }),
      mkdir(path.join(homeDirectory, ".nvm/versions/node/v20.12.0/bin"), {
        recursive: true,
      }),
      mkdir(path.join(homeDirectory, ".nvm/versions/node/v22.4.1/bin"), {
        recursive: true,
      }),
      mkdir(
        path.join(
          homeDirectory,
          ".local/share/fnm/node-versions/v21.7.0/installation/bin"
        ),
        { recursive: true }
      ),
    ])
    process.env.PATH = "/inherited/bin"

    await configureCliPath(homeDirectory)

    expect(process.env.PATH?.split(path.delimiter)).toEqual(
      expect.arrayContaining([
        "/inherited/bin",
        path.join(homeDirectory, ".local/bin"),
        path.join(homeDirectory, ".nvm/versions/node/v22.4.1/bin"),
        path.join(
          homeDirectory,
          ".local/share/fnm/node-versions/v21.7.0/installation/bin"
        ),
      ])
    )
    const bins = process.env.PATH?.split(path.delimiter) ?? []
    expect(
      bins.indexOf(path.join(homeDirectory, ".nvm/versions/node/v22.4.1/bin"))
    ).toBeLessThan(
      bins.indexOf(path.join(homeDirectory, ".nvm/versions/node/v20.12.0/bin"))
    )
  })
})
