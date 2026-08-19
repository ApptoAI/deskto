const storageKey = "deskto.onboarding.completed"

export function readRememberedOnboardingCompleted(): boolean {
  try {
    return window.localStorage.getItem(storageKey) === "true"
  } catch {
    return false
  }
}

export function rememberOnboardingCompleted(completed: boolean): void {
  try {
    window.localStorage.setItem(storageKey, String(completed))
  } catch {
    // Runtime settings remain authoritative when storage is unavailable.
  }
}

/**
 * Whether the welcome wizard owns the window right now. Finishing or skipping
 * dismisses it for the session even under the dev force flag, which otherwise
 * ignores the persisted answer so the wizard can be exercised repeatedly.
 */
export function shouldShowOnboarding(input: {
  completed: boolean
  forceOnboarding: boolean
  dismissedThisSession: boolean
}): boolean {
  if (input.dismissedThisSession) return false
  if (input.forceOnboarding) return true
  return !input.completed
}
