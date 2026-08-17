// @vitest-environment jsdom

import { createElement } from "react"
import { cleanup, render, screen } from "@testing-library/react"
import type {
  SkillInventory,
  SkillOccurrence,
  SkillSource,
} from "@deskto/protocol"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { SkillCatalogItem } from "./skill-catalog.js"
import { SkillList } from "./skill-list.js"

afterEach(cleanup)

describe("SkillList", () => {
  it("keeps source diagnostics visible when no skills were found", () => {
    const brokenSource = source({
      id: "broken-source",
      label: "Broken folder",
      diagnostics: [
        {
          code: "source-unreadable",
          severity: "error",
          message: "Permission denied while reading this folder.",
          path: "/skills/broken",
        },
      ],
    })

    render(
      createElement(SkillList, {
        inventory: inventory([brokenSource], []),
        items: [],
        selectedKey: null,
        filter: "all",
        query: "",
        onSelect: vi.fn(),
      })
    )

    expect(
      screen.getByRole("heading", {
        name: "One skill folder could not be checked",
      })
    ).toBeDefined()
    const diagnostic = screen.getByRole("listitem")
    expect(diagnostic.textContent).toContain("Broken folder:")
    expect(diagnostic.textContent).toContain(
      "Permission denied while reading this folder."
    )
    expect(screen.getByText("No skills found")).toBeDefined()
  })

  it("includes the error status in the skill row's accessible name", () => {
    const skillSource = source({ id: "personal" })
    const skillOccurrence = occurrence({
      id: "review",
      sourceId: skillSource.id,
      diagnostics: [
        {
          code: "frontmatter-invalid",
          severity: "error",
          message: "The frontmatter is invalid.",
          path: "/skills/review/SKILL.md",
        },
      ],
    })
    const item: SkillCatalogItem = {
      key: "name:review",
      name: "review",
      description: "Review a change set",
      occurrences: [{ occurrence: skillOccurrence, source: skillSource }],
      primary: { occurrence: skillOccurrence, source: skillSource },
      group: "detected",
    }

    render(
      createElement(SkillList, {
        inventory: inventory([skillSource], [skillOccurrence]),
        items: [item],
        selectedKey: null,
        filter: "all",
        query: "",
        onSelect: vi.fn(),
      })
    )

    expect(
      screen.getByRole("button", { name: /review.*Needs attention/i })
    ).toBeDefined()
  })
})

function source(overrides: Partial<SkillSource> = {}): SkillSource {
  return {
    id: "source",
    kind: "native",
    scopes: ["user"],
    label: "Personal skills",
    path: "/skills",
    harnessIds: ["codex"],
    editable: false,
    provisioning: [],
    diagnostics: [],
    ...overrides,
  }
}

function occurrence(overrides: Partial<SkillOccurrence> = {}): SkillOccurrence {
  return {
    id: "skill",
    sourceId: "source",
    directoryName: "review",
    directoryPath: "/skills/review",
    resolvedDirectoryPath: "/skills/review",
    skillFilePath: "/skills/review/SKILL.md",
    name: "review",
    description: "Review a change set",
    instructionDigest: null,
    contentDigest: null,
    hasScripts: false,
    hasReferences: false,
    hasAssets: false,
    diagnostics: [],
    ...overrides,
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
