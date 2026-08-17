import { describe, expect, it } from "vitest"
import type {
  SkillInventory,
  SkillOccurrence,
  SkillSource,
} from "@deskto/protocol"

import { buildSkillCatalog, resolveSkillCatalogItem } from "./skill-catalog.js"

const reviewDigest = `sha256:${"a".repeat(64)}`
const otherReviewDigest = `sha256:${"b".repeat(64)}`

function source(id: string, options: Partial<SkillSource> = {}): SkillSource {
  return {
    id,
    kind: "native",
    scopes: ["user"],
    label: id,
    path: `/sources/${id}`,
    harnessIds: ["codex"],
    editable: false,
    provisioning: [],
    diagnostics: [],
    ...options,
  }
}

function occurrence(
  id: string,
  sourceId: string,
  name: string | null,
  options: {
    directoryName?: string
    contentDigest?: string | null
  } = {}
): SkillOccurrence {
  const directoryName = options.directoryName ?? `directory-${id}`
  return {
    id,
    sourceId,
    directoryName,
    directoryPath: `/skills/${id}`,
    resolvedDirectoryPath: `/skills/${id}`,
    skillFilePath: `/skills/${id}/SKILL.md`,
    name,
    description: name ? `Use ${name}` : null,
    instructionDigest: null,
    contentDigest: options.contentDigest ?? null,
    hasScripts: false,
    hasReferences: false,
    hasAssets: false,
    diagnostics: [],
  }
}

function inventory(
  sources: SkillSource[],
  occurrences: SkillOccurrence[]
): SkillInventory {
  return {
    projectId: "project-1",
    scannedAt: "2026-08-17T12:00:00.000Z",
    sources,
    occurrences,
  }
}

describe("buildSkillCatalog", () => {
  it("groups same-name occurrences when their full contents match", () => {
    const result = buildSkillCatalog(
      inventory(
        [source("claude"), source("codex")],
        [
          occurrence("one", "claude", "review", {
            contentDigest: reviewDigest,
          }),
          occurrence("two", "codex", "Review", {
            contentDigest: reviewDigest,
          }),
        ]
      ),
      "all",
      ""
    )

    expect(result).toHaveLength(1)
    expect(result[0]?.occurrences).toHaveLength(2)
  })

  it("keeps same-name occurrences separate when their contents differ", () => {
    const result = buildSkillCatalog(
      inventory(
        [source("claude"), source("codex")],
        [
          occurrence("one", "claude", "review", {
            contentDigest: reviewDigest,
          }),
          occurrence("two", "codex", "Review", {
            contentDigest: otherReviewDigest,
          }),
        ]
      ),
      "all",
      ""
    )

    expect(result).toHaveLength(2)
    expect(result.every((item) => item.occurrences.length === 1)).toBe(true)
  })

  it("keeps invalid unnamed folders as separate entries", () => {
    const result = buildSkillCatalog(
      inventory(
        [source("codex")],
        [occurrence("one", "codex", null), occurrence("two", "codex", null)]
      ),
      "all",
      ""
    )

    expect(result).toHaveLength(2)
  })

  it("keeps broken and null-digest copies separate", () => {
    const result = buildSkillCatalog(
      inventory(
        [source("claude"), source("codex")],
        [
          occurrence("broken", "claude", null, { directoryName: "review" }),
          occurrence("valid", "codex", "review", {
            directoryName: "review",
            contentDigest: reviewDigest,
          }),
        ]
      ),
      "all",
      ""
    )

    expect(result).toHaveLength(2)
    expect(result.map((item) => item.primary.occurrence.id).sort()).toEqual([
      "broken",
      "valid",
    ])
  })

  it("filters by source scope before grouping", () => {
    const result = buildSkillCatalog(
      inventory(
        [
          source("native"),
          source("pack", {
            kind: "pack",
            scopes: ["workspace"],
            packId: "pack-1",
            packKind: "managed",
            editable: true,
          }),
        ],
        [
          occurrence("native", "native", "native-skill"),
          occurrence("pack", "pack", "pack-skill"),
        ]
      ),
      "workspace",
      ""
    )

    expect(result.map((item) => item.name)).toEqual(["pack-skill"])
  })

  it("searches agent display names", () => {
    const result = buildSkillCatalog(
      inventory(
        [source("personal", { harnessIds: ["claude"] })],
        [occurrence("one", "personal", "release-notes")]
      ),
      "all",
      "code"
    )

    expect(result.map((item) => item.name)).toEqual(["release-notes"])
  })
})

describe("resolveSkillCatalogItem", () => {
  it("keeps an occurrence selected when editing changes its catalog key", () => {
    const original = buildSkillCatalog(
      inventory(
        [source("personal"), source("native")],
        [
          occurrence("renamed", "personal", "before", {
            contentDigest: reviewDigest,
          }),
          occurrence("unchanged-copy", "native", "before", {
            contentDigest: reviewDigest,
          }),
          occurrence("first", "personal", "another", {
            contentDigest: otherReviewDigest,
          }),
        ]
      ),
      "all",
      ""
    )
    const selected = original.find((item) => item.name === "before")!
    const refreshed = buildSkillCatalog(
      inventory(
        [source("personal"), source("native")],
        [
          occurrence("renamed", "personal", "after", {
            contentDigest: `sha256:${"c".repeat(64)}`,
          }),
          occurrence("unchanged-copy", "native", "before", {
            contentDigest: reviewDigest,
          }),
          occurrence("first", "personal", "another", {
            contentDigest: otherReviewDigest,
          }),
        ]
      ),
      "all",
      ""
    )

    expect(
      resolveSkillCatalogItem(refreshed, {
        itemKey: selected.key,
        occurrenceId: "renamed",
      })?.name
    ).toBe("after")
  })
})
