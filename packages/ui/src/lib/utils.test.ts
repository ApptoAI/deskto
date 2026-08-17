import { describe, expect, it } from "vitest"

import { cn } from "./utils.js"

describe("cn", () => {
  it.each(["tiny", "micro", "ui", "reading"])(
    "keeps the custom text-%s size beside a text color",
    (size) => {
      expect(cn(`text-${size}`, "text-muted-foreground")).toBe(
        `text-${size} text-muted-foreground`
      )
    }
  )

  it("merges custom text sizes with standard font-size utilities", () => {
    expect(cn("text-sm", "text-ui")).toBe("text-ui")
  })
})
