import { describe, expect, it } from "vitest"

import {
  sanitizeThreadTitle,
  threadTitlePrompt,
} from "./thread-title-generator.js"

describe("Thread title generation", () => {
  it("asks for a short title in the user's language", () => {
    const prompt = threadTitlePrompt("Dodaj wyszukiwanie do panelu")
    expect(prompt).toContain("Use the same language as the user")
    expect(prompt).toContain("Never explain, refuse, or judge")
    expect(prompt).toContain("Dodaj wyszukiwanie do panelu")
  })

  it("cleans common model wrappers from the title", () => {
    expect(
      sanitizeThreadTitle('```text\nTytuł: "Dodaj wyszukiwanie"\n```')
    ).toBe("Dodaj wyszukiwanie")
    expect(sanitizeThreadTitle("New task")).toBeUndefined()
    expect(
      sanitizeThreadTitle(
        `I don't see a task in your message — "tada" is just a celebration`,
        "tada"
      )
    ).toBe("tada")
  })
})
