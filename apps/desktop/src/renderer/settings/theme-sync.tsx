import { useEffect } from "react"
import { appSettings, settingValue } from "@deskto/settings"

import { applyTheme, rememberTheme } from "../lib/theme.js"
import {
  applyInterfaceFontSize,
  rememberInterfaceFontSize,
} from "../lib/interface-size.js"
import { rememberOnboardingCompleted } from "../lib/onboarding.js"
import { rememberWorkspaceLayout } from "../lib/workspace-layout.js"
import { useSettings } from "./settings-context.js"

/**
 * Holds the document's palette to the stored preference. Renders nothing: the
 * theme is a property of the window, not of any one screen.
 *
 * It stands down until settings load. Before that the value the inline script
 * in index.html applied is the better guess — reapplying the default here
 * would flash every user who picked something other than System.
 */
export function ThemeSync() {
  const { snapshot } = useSettings()
  const theme = settingValue(snapshot, appSettings.theme)

  useEffect(() => {
    if (!snapshot) return
    rememberTheme(theme)
    applyTheme(theme)

    // Only "system" has anything left to follow; the other two are answers.
    if (theme !== "system") return
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const followSystem = () => applyTheme("system")
    media.addEventListener("change", followSystem)
    return () => media.removeEventListener("change", followSystem)
  }, [snapshot, theme])

  return null
}

/** Keeps the shared type scale aligned with the persisted text size. */
export function InterfaceSizeSync() {
  const { snapshot } = useSettings()
  const size = settingValue(snapshot, appSettings.interfaceFontSize)

  useEffect(() => {
    if (!snapshot) return
    rememberInterfaceFontSize(size)
    applyInterfaceFontSize(size)
  }, [snapshot, size])

  return null
}

/** Refreshes the startup cache after the Runtime supplies its answer. */
export function WorkspaceLayoutSync() {
  const { snapshot } = useSettings()
  const layout = settingValue(snapshot, appSettings.workspaceLayout)

  useEffect(() => {
    if (!snapshot) return
    rememberWorkspaceLayout(layout)
  }, [snapshot, layout])

  return null
}

/** Refreshes the startup cache after the Runtime supplies its answer. */
export function OnboardingCompletedSync() {
  const { snapshot } = useSettings()
  const completed = settingValue(snapshot, appSettings.onboardingCompleted)

  useEffect(() => {
    if (!snapshot) return
    rememberOnboardingCompleted(completed)
  }, [snapshot, completed])

  return null
}
