import { type ThemePreference } from "@deskto/settings"

/**
 * The window's palette.
 *
 * The Runtime owns the preference like every other setting, but it arrives
 * over IPC a beat after the first paint — long enough for a light-mode user to
 * watch the app open dark and then correct itself. So every resolved
 * preference is mirrored into localStorage, and the inline script in
 * index.html reads that mirror back before the first paint; `ThemeSync` holds
 * the document to the real preference from then on. The mirror is a cache,
 * never the source: whatever the Runtime says wins the moment it answers.
 *
 * The key below is hard-coded in index.html too, which has to run before any
 * module does; the two have to stay in step.
 */

const storageKey = "deskto.appearance.theme"

export function rememberTheme(theme: ThemePreference): void {
  try {
    window.localStorage.setItem(storageKey, theme)
  } catch {
    // A full or blocked store costs a flash on the next launch, nothing more.
  }
}

function prefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

/**
 * Puts the palette on the document. `color-scheme` goes with it so the parts
 * the app does not draw — form controls, native scrollbars, the space behind
 * an overscroll — are not left in the other theme.
 */
export function applyTheme(theme: ThemePreference): void {
  const dark = theme === "dark" || (theme === "system" && prefersDark())
  const root = document.documentElement
  root.classList.toggle("dark", dark)
  root.style.colorScheme = dark ? "dark" : "light"
}
