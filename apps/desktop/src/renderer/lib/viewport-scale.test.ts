import { describe, expect, it } from "vitest"

import { interfaceViewportScale } from "./viewport-scale.js"

describe("interfaceViewportScale", () => {
  it("keeps ordinary and OS-scaled viewports at native size", () => {
    expect(interfaceViewportScale(1280, 720)).toBe(1)
    expect(interfaceViewportScale(1920, 1080)).toBe(1)
  })

  it("scales the whole interface on high-resolution viewports", () => {
    expect(interfaceViewportScale(2560, 1440)).toBe(1.25)
    expect(interfaceViewportScale(3840, 2160)).toBe(2)
  })

  it("uses the limiting dimension and caps very large displays", () => {
    expect(interfaceViewportScale(3440, 1440)).toBe(1.25)
    expect(interfaceViewportScale(7680, 4320)).toBe(2)
  })
})
