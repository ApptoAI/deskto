import {
  defaultInterfaceFontSize,
  maxInterfaceFontSize,
  minInterfaceFontSize,
} from "@deskto/settings"
import { describe, expect, it } from "vitest"

import bootstrapHtml from "../index.html?raw"
import {
  interfaceFontScale,
  interfaceFontSizeStorageKey,
} from "./interface-size.js"

describe("interfaceFontScale", () => {
  it("maps the supported text sizes around the default", () => {
    expect(interfaceFontScale(12)).toBe(0.75)
    expect(interfaceFontScale(16)).toBe(1)
    expect(interfaceFontScale(20)).toBe(1.25)
  })

  it("keeps the pre-paint bootstrap aligned with the settings registry", () => {
    expect(bootstrapHtml).toContain(`getItem("${interfaceFontSizeStorageKey}")`)
    expect(bootstrapHtml).toContain(`storedSize >= ${minInterfaceFontSize}`)
    expect(bootstrapHtml).toContain(`storedSize <= ${maxInterfaceFontSize}`)
    expect(bootstrapHtml).toContain(
      `String(storedSize / ${defaultInterfaceFontSize})`
    )
  })
})
