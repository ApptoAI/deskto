// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest"

import {
  readRememberedOnboardingCompleted,
  rememberOnboardingCompleted,
  shouldShowOnboarding,
} from "./onboarding.js"

afterEach(() => window.localStorage.clear())

describe("shouldShowOnboarding", () => {
  it.each([
    // dismissed wins over everything, force wins over completed
    { completed: false, forceOnboarding: false, dismissedThisSession: false, expected: true },
    { completed: true, forceOnboarding: false, dismissedThisSession: false, expected: false },
    { completed: true, forceOnboarding: true, dismissedThisSession: false, expected: true },
    { completed: false, forceOnboarding: true, dismissedThisSession: true, expected: false },
    { completed: false, forceOnboarding: false, dismissedThisSession: true, expected: false },
  ])(
    "completed=$completed force=$forceOnboarding dismissed=$dismissedThisSession -> $expected",
    ({ expected, ...input }) => {
      expect(shouldShowOnboarding(input)).toBe(expected)
    }
  )
})

describe("remembered onboarding cache", () => {
  it("defaults to false when nothing is stored", () => {
    expect(readRememberedOnboardingCompleted()).toBe(false)
  })

  it("round-trips the stored answer", () => {
    rememberOnboardingCompleted(true)
    expect(readRememberedOnboardingCompleted()).toBe(true)
    rememberOnboardingCompleted(false)
    expect(readRememberedOnboardingCompleted()).toBe(false)
  })

  it("treats junk in storage as not completed", () => {
    window.localStorage.setItem("deskto.onboarding.completed", "yes please")
    expect(readRememberedOnboardingCompleted()).toBe(false)
  })
})
