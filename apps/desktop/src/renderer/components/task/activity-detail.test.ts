import { describe, expect, it } from "vitest"

import {
  shortenActivityDetail,
  shortenCommand,
  shortenPath,
} from "./activity-detail.js"

const project = "/home/someone/.config/@deskto/desktop/projects/Notes"

describe("shortenPath", () => {
  it("drops the project root a path sits under", () => {
    expect(shortenPath(`${project}/README.md`, project)).toBe("README.md")
  })

  it("keeps the last two segments of a deep path", () => {
    expect(shortenPath(`${project}/src/renderer/index.ts`, project)).toBe(
      "renderer/index.ts"
    )
  })

  it("shortens a path from outside the project too", () => {
    expect(shortenPath("/etc/nginx/conf.d/site.conf", project)).toBe(
      "conf.d/site.conf"
    )
  })

  it("leaves a short relative path alone", () => {
    expect(shortenPath("./notes.md", project)).toBe("notes.md")
    expect(shortenPath("src/app.ts", project)).toBe("src/app.ts")
  })

  it("survives a missing project root", () => {
    expect(shortenPath("/one/two/three/four.txt")).toBe("three/four.txt")
  })

  it("reads a Windows path, separators and all", () => {
    expect(shortenPath("C:\\work\\notes\\src\\index.ts")).toBe(
      "src/index.ts"
    )
  })
})

describe("shortenCommand", () => {
  it("keeps the program and what it runs on", () => {
    expect(shortenCommand("ls -la /home/someone/.config/@deskto")).toBe("ls -la…")
  })

  it("leaves a command that is already short", () => {
    expect(shortenCommand("pnpm test")).toBe("pnpm test")
    expect(shortenCommand("ls")).toBe("ls")
  })

  it("does not report a pipeline as its first step alone", () => {
    expect(shortenCommand("cat notes.md | wc -l")).toBe("cat notes.md…")
  })

  it("collapses the whitespace a multi-line command carries", () => {
    expect(shortenCommand("git   commit -m 'x'")).toBe("git commit…")
  })
})

describe("shortenActivityDetail", () => {
  it("routes a path to path shortening and a command to command shortening", () => {
    expect(shortenActivityDetail(`${project}/README.md`, project)).toBe(
      "README.md"
    )
    expect(shortenActivityDetail("rg --files -g '*.ts'", project)).toBe("rg --files…")
  })

  it("takes a Windows path as a path, even with a space in a folder name", () => {
    // Whitespace normally marks a command, so the drive letter has to win:
    // shortened as a command this reads "C:\\work…", which names nothing.
    expect(
      shortenActivityDetail("C:\\work\\My Project\\src\\index.ts")
    ).toBe("src/index.ts")
  })

  it("still reads a command that contains a path as a command", () => {
    expect(shortenActivityDetail("ls -la /home/someone/notes", project)).toBe(
      "ls -la…"
    )
  })

  it("leaves a bare word — a search term, a tool name — untouched", () => {
    expect(shortenActivityDetail("partitionInbox", project)).toBe(
      "partitionInbox"
    )
  })
})
