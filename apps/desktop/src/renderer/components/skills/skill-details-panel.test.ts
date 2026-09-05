// @vitest-environment jsdom

import { createElement } from "react"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import type { SkillOccurrence, SkillSource } from "@deskto/protocol"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  instructionsFromSkillContent,
  SkillDetailsPanel,
} from "./skill-details-panel.js"
import type { CatalogOccurrence, SkillCatalogItem } from "./skill-catalog.js"

afterEach(cleanup)

describe("instructionsFromSkillContent", () => {
  it("removes YAML frontmatter from editable instructions", () => {
    expect(
      instructionsFromSkillContent(
        "---\nname: Brief\ndescription: Draft a brief\n---\n\nWrite the brief.\n"
      )
    ).toBe("Write the brief.")
  })

  it("keeps files without frontmatter readable", () => {
    expect(instructionsFromSkillContent("Plain instructions\n")).toBe(
      "Plain instructions"
    )
  })
})

describe("SkillDetailsPanel", () => {
  it("edits complete native instructions against the loaded version", async () => {
    const native = source("native", { editable: true })
    const selected = catalogOccurrence(occurrence("review", native.id), native)
    const content =
      "---\nname: review\ndescription: Review\nlicense: MIT\n---\nInstructions"
    const onUpdateContent = vi.fn().mockResolvedValue(undefined)
    render(
      createElement(SkillDetailsPanel, {
        item: {
          key: "review",
          name: "review",
          description: "Review",
          primary: selected,
          occurrences: [selected],
          group: "detected",
        },
        selected,
        state: {
          status: "ready",
          data: { occurrence: selected.occurrence, content },
        },
        onSelectOccurrence: vi.fn(),
        onRetry: vi.fn(),
        onUpdateManaged: vi.fn(),
        onUpdateContent,
      })
    )
    fireEvent.click(screen.getByRole("button", { name: "Edit skill" }))
    const input = screen.getByRole("textbox", { name: "SKILL.md" })
    expect(input).toHaveProperty("value", content)
    fireEvent.change(input, { target: { value: content + " updated" } })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() =>
      expect(onUpdateContent).toHaveBeenCalledWith(
        content + " updated",
        content
      )
    )
  })

  it("shows failed delivery for the selected Pack copy", () => {
    const packSource = source("pack", {
      kind: "pack",
      scopes: ["workspace"],
      label: "Shared review Pack",
      harnessIds: ["codex"],
      packId: "pack-1",
      packKind: "managed",
      editable: true,
      provisioning: [
        {
          turnId: "turn-1",
          rootId: "pack-1",
          harnessId: "codex",
          rootPath: "/packs/review/skills",
          contentDigest: null,
          status: "failed",
          method: "extra-root",
          message: "The installed version rejected the skill root.",
          attemptedAt: "2026-08-17T12:00:00.000Z",
        },
      ],
    })
    const nativeSource = source("native", {
      label: "Claude personal skills",
      harnessIds: ["claude"],
    })
    const selected = catalogOccurrence(
      occurrence("pack-copy", packSource.id),
      packSource
    )
    const otherCopy = catalogOccurrence(
      occurrence("native-copy", nativeSource.id),
      nativeSource
    )
    const item: SkillCatalogItem = {
      key: "name:review",
      name: "review",
      description: "Review a change set",
      occurrences: [selected, otherCopy],
      primary: selected,
      group: "personal",
    }

    render(
      createElement(SkillDetailsPanel, {
        item,
        selected,
        state: {
          status: "ready",
          data: { occurrence: selected.occurrence, content: null },
        },
        onSelectOccurrence: vi.fn(),
        onRetry: vi.fn(),
        onUpdateManaged: vi.fn(),
      })
    )

    expect(screen.getByText("Delivery failed")).toBeDefined()
    expect(
      screen.getByText("Could not provide this Pack to Codex")
    ).toBeDefined()
    expect(
      screen.getByText("The installed version rejected the skill root.")
    ).toBeDefined()
    const article = screen.getByRole("article")
    const header = article.querySelector("header")
    expect(header).not.toBeNull()
    const selectedHeader = within(header!)
    expect(
      selectedHeader.getByText("Codex · attached to this workspace")
    ).toBeDefined()
    expect(selectedHeader.queryByText(/Claude/)).toBeNull()
  })

  it("shows partial configuration when an agent has no delivery report", () => {
    const packSource = source("pack", {
      kind: "pack",
      scopes: ["workspace"],
      label: "Shared review Pack",
      harnessIds: ["codex", "claude"],
      packId: "pack-1",
      packKind: "managed",
      editable: true,
      provisioning: [
        {
          turnId: "turn-1",
          rootId: "pack-1",
          harnessId: "codex",
          rootPath: "/packs/review/skills",
          contentDigest: null,
          status: "configured",
          method: "extra-root",
          attemptedAt: "2026-08-17T12:00:00.000Z",
        },
      ],
    })
    const selected = catalogOccurrence(
      occurrence("pack-copy", packSource.id),
      packSource
    )
    const item: SkillCatalogItem = {
      key: "copy:review",
      name: "review",
      description: "Review a change set",
      occurrences: [selected],
      primary: selected,
      group: "personal",
    }

    render(
      createElement(SkillDetailsPanel, {
        item,
        selected,
        state: {
          status: "ready",
          data: { occurrence: selected.occurrence, content: null },
        },
        onSelectOccurrence: vi.fn(),
        onRetry: vi.fn(),
        onUpdateManaged: vi.fn(),
      })
    )

    expect(screen.getByText("Partially configured")).toBeDefined()
    expect(screen.getByText("Configured for Codex")).toBeDefined()
    expect(
      screen.getByText("Claude Code has not received this Pack yet")
    ).toBeDefined()
  })
})

function source(id: string, overrides: Partial<SkillSource> = {}): SkillSource {
  return {
    id,
    kind: "native",
    scopes: ["user"],
    label: "Personal skills",
    path: `/sources/${id}`,
    harnessIds: ["codex"],
    editable: false,
    provisioning: [],
    diagnostics: [],
    ...overrides,
  }
}

function occurrence(id: string, sourceId: string): SkillOccurrence {
  return {
    id,
    sourceId,
    directoryName: "review",
    directoryPath: `/sources/${sourceId}/review`,
    resolvedDirectoryPath: `/sources/${sourceId}/review`,
    skillFilePath: `/sources/${sourceId}/review/SKILL.md`,
    name: "review",
    description: "Review a change set",
    instructionDigest: null,
    contentDigest: null,
    hasScripts: false,
    hasReferences: false,
    hasAssets: false,
    diagnostics: [],
  }
}

function catalogOccurrence(
  skill: SkillOccurrence,
  skillSource: SkillSource
): CatalogOccurrence {
  return { occurrence: skill, source: skillSource }
}
