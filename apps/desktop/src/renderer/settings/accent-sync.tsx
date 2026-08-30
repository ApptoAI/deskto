import { useEffect } from "react"
import type { Workspace } from "@deskto/protocol"
import type { AccentSource } from "@deskto/settings"

import { workspaceAccent } from "../components/workspace/workspace-theme.js"

/**
 * Puts the accent on the document, or takes it off.
 *
 * The palette states its monochrome values as fallbacks inside `var()`, so the
 * accent is applied by the presence of these variables and removed by their
 * absence — there is no second rule competing with the first, and nothing to
 * keep in step when a token moves.
 *
 * The contrast colour is chosen rather than themed: every Workspace accent is
 * a mid-lightness chroma, so a near-black label sits on all eight of them in
 * either palette, and flipping it with the theme would fail on the light ones.
 */
export function useAccentSync(
  source: AccentSource,
  workspace: Workspace | null
): void {
  const accent =
    source === "workspace" ? workspaceAccent(workspace?.color) : null

  useEffect(() => {
    const root = document.documentElement
    if (accent === null) {
      root.style.removeProperty("--accent-base")
      root.style.removeProperty("--accent-contrast")
      root.style.removeProperty("--accent-ring")
      return
    }
    root.style.setProperty("--accent-base", accent)
    root.style.setProperty("--accent-contrast", "oklch(0.16 0.01 286)")
    root.style.setProperty(
      "--accent-ring",
      `color-mix(in oklch, ${accent} 55%, transparent)`
    )
  }, [accent])
}
