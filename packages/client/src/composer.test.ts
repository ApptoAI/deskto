import { describe, expect, it } from "vitest"

import {
  detectComposerTrigger,
  formatProjectReference,
  reconcilePromptReferences,
  replaceComposerTrigger,
} from "./composer.js"

describe("composer grammar", () => {
  it.each([
    ["Open @src/ind", "project-entry", "src/ind"],
    ["Use $review", "skill", "review"],
    ["/mod", "command", "mod"],
  ] as const)("detects %s", (text, kind, query) => {
    expect(detectComposerTrigger(text, text.length)).toMatchObject({
      kind,
      query,
    })
  })

  it("uses the actual caret instead of the end of the draft", () => {
    const text = "Open @src then continue"
    expect(detectComposerTrigger(text, "Open @src".length)).toMatchObject({
      kind: "project-entry",
      query: "src",
    })
  })

  it.each(["See (@src", "Compare notes,@src"])(
    "detects a trigger after punctuation in %s",
    (text) => {
      expect(detectComposerTrigger(text, text.length)).toMatchObject({
        kind: "project-entry",
        query: "src",
      })
    }
  )

  it("does not treat an email address as a mention", () => {
    const text = "Send to hello@example.com"
    expect(detectComposerTrigger(text, text.length)).toBeNull()
  })

  it("does not treat a URI path as an application command", () => {
    const text = "Open file:/model"
    expect(detectComposerTrigger(text, text.length)).toBeNull()
  })

  it("replaces only the active token", () => {
    const text = "Compare @old with the rest"
    const trigger = detectComposerTrigger(text, "Compare @old".length)!
    expect(replaceComposerTrigger(text, trigger, "@src/new.ts ")).toEqual({
      text: "Compare @src/new.ts  with the rest",
      cursor: "Compare @src/new.ts ".length,
    })
  })

  it("quotes project paths with spaces", () => {
    expect(formatProjectReference("docs/My File.md")).toBe('@"docs/My File.md"')
  })

  it("drops semantic references whose tokens were deleted", () => {
    expect(
      reconcilePromptReferences("Use $review", [
        { kind: "skill", skillId: "p/review", name: "review" },
        { kind: "project-entry", path: "src/a.ts", entryKind: "file" },
      ])
    ).toEqual([{ kind: "skill", skillId: "p/review", name: "review" }])
  })

  it("does not retain a reference that only prefixes another token", () => {
    expect(
      reconcilePromptReferences("Use $review-long", [
        { kind: "skill", skillId: "p/review", name: "review" },
      ])
    ).toEqual([])
  })

  it("retains a reference followed by punctuation", () => {
    expect(
      reconcilePromptReferences("Use $review, please", [
        { kind: "skill", skillId: "p/review", name: "review" },
      ])
    ).toHaveLength(1)
  })

  it("keeps only the latest identity for duplicate skill tokens", () => {
    expect(
      reconcilePromptReferences("Use $review", [
        { kind: "skill", skillId: "first/review", name: "review" },
        { kind: "skill", skillId: "second/review", name: "review" },
      ])
    ).toEqual([{ kind: "skill", skillId: "second/review", name: "review" }])
  })
})
