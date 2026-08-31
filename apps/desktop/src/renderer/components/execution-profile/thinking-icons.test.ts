import { describe, expect, it } from "vitest"

import { effortRank } from "./thinking-icons.js"

describe("effortRank", () => {
  it("gives six ordered efforts distinct glyph depths", () => {
    const efforts = ["low", "medium", "high", "xhigh", "max", "ultra"]

    expect(efforts.map((effort) => effortRank(effort, efforts))).toEqual([
      1, 2, 3, 4, 5, 6,
    ])
  })

  it("keeps none empty and a single explicit effort full", () => {
    expect(effortRank("none", ["none", "high"])).toBe(0)
    expect(effortRank("high", ["none", "high"])).toBe(6)
  })
})
