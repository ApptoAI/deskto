import { describe, expect, it } from "vitest"

import { instructionsFromSkillContent } from "./skill-details-dialog.js"

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
