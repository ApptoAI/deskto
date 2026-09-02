// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { applyTheme } from "./theme.js"

function stubMedia(matches: { dark: boolean; reducedMotion: boolean }) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("prefers-color-scheme")
        ? matches.dark
        : matches.reducedMotion,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  )
}

describe("applyTheme", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    document.documentElement.className = ""
    document.documentElement.style.colorScheme = ""
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("puts the palette and the matching color-scheme on the document", () => {
    stubMedia({ dark: false, reducedMotion: false })
    applyTheme("dark")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe("dark")

    applyTheme("light")
    expect(document.documentElement.classList.contains("dark")).toBe(false)
    expect(document.documentElement.style.colorScheme).toBe("light")
  })

  it("follows the system preference only for system", () => {
    stubMedia({ dark: true, reducedMotion: false })
    applyTheme("system")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    applyTheme("light")
    expect(document.documentElement.classList.contains("dark")).toBe(false)
  })

  it("cross-fades a palette change and clears the class after it lands", () => {
    stubMedia({ dark: false, reducedMotion: false })
    applyTheme("dark")
    expect(
      document.documentElement.classList.contains("theme-transition")
    ).toBe(true)
    vi.advanceTimersByTime(200)
    expect(
      document.documentElement.classList.contains("theme-transition")
    ).toBe(false)
  })

  it("does not cross-fade when the palette is unchanged", () => {
    stubMedia({ dark: false, reducedMotion: false })
    applyTheme("light")
    expect(
      document.documentElement.classList.contains("theme-transition")
    ).toBe(false)
  })

  it("swaps instantly under reduced motion", () => {
    stubMedia({ dark: false, reducedMotion: true })
    applyTheme("dark")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(
      document.documentElement.classList.contains("theme-transition")
    ).toBe(false)
  })
})
