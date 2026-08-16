import BotIcon from "lucide-react/dist/esm/icons/bot"
import KeyboardIcon from "lucide-react/dist/esm/icons/keyboard"
import SparklesIcon from "lucide-react/dist/esm/icons/sparkles"
import type { ComponentType, SVGProps } from "react"

// Settings is its own screen with one topic per page. The tuple is the sidebar
// order and the source of the id union, so a page cannot exist in one and be
// missing from the other.
export const settingsPageOrder = ["agents", "models", "shortcuts"] as const

export type SettingsPageId = (typeof settingsPageOrder)[number]

type SettingsPage = {
  label: string
  /** Sits under the page title, so it says what the whole screen is for. */
  description: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
}

export const settingsPages = {
  agents: {
    label: "Agents",
    description: "Choose which agents Deskto may use for your tasks.",
    icon: BotIcon,
  },
  models: {
    label: "Generated text",
    description: "Choose models for short text Deskto creates automatically.",
    icon: SparklesIcon,
  },
  shortcuts: {
    label: "Keyboard shortcuts",
    description: "Click a shortcut, then press the new key combination.",
    icon: KeyboardIcon,
  },
} satisfies Record<SettingsPageId, SettingsPage>

export const firstSettingsPage = settingsPageOrder[0]
