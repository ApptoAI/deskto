import { describe, expect, it } from "vitest"
import type { TurnOutput } from "@deskto/protocol"

import {
  folderCrumbs,
  listFolder,
  parentFolder,
  resolveFolder,
  sharedFolder,
} from "./file-listing.js"

function output(relativePath: string): TurnOutput {
  const timestamp = "2026-08-16T10:00:06.000Z"
  const name = relativePath.split("/").pop() ?? relativePath
  return {
    turnId: "turn-1",
    producedAt: timestamp,
    artifact: {
      id: relativePath,
      projectId: "project-1",
      name,
      relativePath,
      mediaType: "text/markdown",
      previewKind: "markdown",
      openable: true,
      sizeBytes: 42,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  }
}

function rowNames(outputs: TurnOutput[], folder: string): string[] {
  return listFolder(outputs, folder).map((row) =>
    row.kind === "folder" ? `${row.name}/` : row.output.artifact.name
  )
}

describe("file listing", () => {
  it("puts folders before files and keeps the order files arrived in", () => {
    const outputs = [
      output("notes.md"),
      output("docs/adr/0014.md"),
      output("report.md"),
      output("docs/guide.md"),
    ]

    expect(rowNames(outputs, "")).toEqual(["docs/", "notes.md", "report.md"])
    expect(listFolder(outputs, "")[0]).toMatchObject({
      path: "docs",
      fileCount: 2,
    })
    expect(rowNames(outputs, "docs")).toEqual(["adr/", "guide.md"])
  })

  it("collapses a chain of folders that holds nothing else", () => {
    const outputs = [
      output("src/renderer/components/task.tsx"),
      output("src/renderer/components/panel.tsx"),
    ]

    expect(listFolder(outputs, "")).toEqual([
      {
        kind: "folder",
        path: "src/renderer/components",
        name: "src/renderer/components",
        fileCount: 2,
      },
    ])
    expect(rowNames(outputs, "src/renderer/components")).toEqual([
      "task.tsx",
      "panel.tsx",
    ])
  })

  it("stops collapsing where the chain branches or holds a file", () => {
    const branching = [output("src/main/index.ts"), output("src/web/app.tsx")]
    expect(rowNames(branching, "src")).toEqual(["main/", "web/"])

    const held = [output("src/index.ts"), output("src/lib/util.ts")]
    expect(rowNames(held, "")).toEqual(["src/"])
    expect(rowNames(held, "src")).toEqual(["lib/", "index.ts"])
  })

  it("climbs to the nearest folder that still holds files", () => {
    const outputs = [output("docs/adr/0014.md")]

    expect(resolveFolder(outputs, "docs/adr")).toBe("docs/adr")
    expect(resolveFolder(outputs, "docs/notes/drafts")).toBe("docs")
    expect(resolveFolder(outputs, "elsewhere")).toBe("")
  })

  it("stands where an answer's own files are all in view", () => {
    expect(
      sharedFolder([output("output/one.md"), output("output/two.md")])
    ).toBe("output")
    expect(
      sharedFolder([output("output/csv/one.csv"), output("notes/two.md")])
    ).toBe("")
    expect(sharedFolder([output("docs/adr/0014.md")])).toBe("docs/adr")
    expect(sharedFolder([])).toBe("")
  })

  it("names every segment of a path a crumb can open", () => {
    expect(folderCrumbs("src/renderer/components")).toEqual([
      { name: "src", path: "src" },
      { name: "renderer", path: "src/renderer" },
      { name: "components", path: "src/renderer/components" },
    ])
    expect(folderCrumbs("")).toEqual([])
    expect(parentFolder("docs/adr/0014.md")).toBe("docs/adr")
    expect(parentFolder("notes.md")).toBe("")
  })
})
