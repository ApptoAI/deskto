import { describe, expect, it } from "vitest"
import type { SkillOccurrence } from "@deskto/protocol"

import { skillNameCounts } from "./skill-list.js"

function occurrence(id: string, name: string | null): SkillOccurrence {
  return {
    id,
    sourceId: `source-${id}`,
    directoryName: `directory-${id}`,
    directoryPath: `/skills/${id}`,
    resolvedDirectoryPath: `/skills/${id}`,
    skillFilePath: `/skills/${id}/SKILL.md`,
    name,
    description: null,
    instructionDigest: null,
    contentDigest: null,
    hasScripts: false,
    hasReferences: false,
    hasAssets: false,
    diagnostics: [],
  }
}

describe("skillNameCounts", () => {
  it("counts duplicate names without removing occurrences", () => {
    const skills = [
      occurrence("one", "review"),
      occurrence("two", "review"),
      occurrence("three", "release"),
    ]

    expect(skillNameCounts(skills)).toEqual(
      new Map([
        ["review", 2],
        ["release", 1],
      ])
    )
    expect(skills).toHaveLength(3)
  })

  it("does not group invalid skills without a parsed name", () => {
    expect(skillNameCounts([occurrence("broken", null)])).toEqual(new Map())
  })
})
