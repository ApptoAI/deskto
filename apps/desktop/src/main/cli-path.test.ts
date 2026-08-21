import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { configureCliPath, readWindowsEnvironmentPath } from "./cli-path.js"

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

  it("finds Windows package-manager shims", async () => {
    const environment: NodeJS.ProcessEnv = {
      Path: String.raw`C:\Windows\System32`,
      APPDATA: String.raw`C:\Users\person\AppData\Roaming`,
      LOCALAPPDATA: String.raw`C:\Users\person\AppData\Local`,
      PNPM_HOME: String.raw`C:\Users\person\AppData\Local\pnpm-home`,
      NVM_SYMLINK: String.raw`C:\Program Files\nodejs`,
    }

    await configureCliPath(String.raw`C:\Users\person`, {
      platform: "win32",
      environment,
      windowsPathReader: () =>
        Promise.resolve(
          String.raw`C:\Users\person\custom-bin;C:\WINDOWS\system32`
        ),
    })

    expect(environment.Path?.split(";")).toEqual(
      expect.arrayContaining([
        String.raw`C:\WINDOWS\system32`,
        String.raw`C:\Users\person\custom-bin`,
        String.raw`C:\Users\person\AppData\Roaming\npm`,
        String.raw`C:\Users\person\AppData\Local\Programs\nodejs`,
        String.raw`C:\Users\person\AppData\Local\Volta\bin`,
        String.raw`C:\Users\person\AppData\Local\pnpm`,
        String.raw`C:\Users\person\AppData\Local\pnpm-home`,
        String.raw`C:\Program Files\nodejs`,
        String.raw`C:\Users\person\scoop\shims`,
      ])
    )
    expect(
      environment.Path?.split(";").filter(
        (entry) => entry.toLowerCase() === String.raw`c:\windows\system32`
      )
    ).toHaveLength(1)
  })

  it("falls back to the absolute Windows PowerShell path", async () => {
    const probe = vi.fn((shell: string) =>
      Promise.resolve(
        shell.includes("WindowsPowerShell")
          ? String.raw`C:\Users\person\bin`
          : undefined
      )
    )

    await expect(
      readWindowsEnvironmentPath({ SystemRoot: String.raw`C:\Windows` }, probe)
    ).resolves.toBe(String.raw`C:\Users\person\bin`)
    expect(probe.mock.calls.map(([shell]) => shell)).toEqual([
      "pwsh.exe",
      "powershell.exe",
      String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`,
    ])
  })
})
