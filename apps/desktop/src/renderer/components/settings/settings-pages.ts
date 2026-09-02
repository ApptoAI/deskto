import BotIcon from "lucide-react/dist/esm/icons/bot"
import ContrastIcon from "lucide-react/dist/esm/icons/contrast"
import KeyboardIcon from "lucide-react/dist/esm/icons/keyboard"
import InfoIcon from "lucide-react/dist/esm/icons/info"
import MousePointerClickIcon from "lucide-react/dist/esm/icons/mouse-pointer-click"
import SparklesIcon from "lucide-react/dist/esm/icons/sparkles"
import type { ComponentType, SVGProps } from "react"

// Settings is its own screen with one topic per page. The tuple is the sidebar
// order and the source of the id union, so a page cannot exist in one and be
// missing from the other.
export const settingsPageOrder = [
  "agents",
  "models",
  "computer-use",
  "appearance",
  "shortcuts",
  "about",
] as const

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
    label: "Models",
    description: "Choose which models Deskto offers and uses automatically.",
    icon: SparklesIcon,
  },
  "computer-use": {
    label: "Computer use",
    description: "Choose how the built-in browser behaves inside your tasks.",
    icon: MousePointerClickIcon,
  },
  appearance: {
    label: "Appearance",
    description: "Choose the theme, workspace layout, and text size.",
    icon: ContrastIcon,
  },
  shortcuts: {
    label: "Keyboard shortcuts",
    description: "Click a shortcut, then press the new key combination.",
    icon: KeyboardIcon,
  },
  about: {
    label: "About",
    description: "See your Deskto version and manage application updates.",
    icon: InfoIcon,
  },
} satisfies Record<SettingsPageId, SettingsPage>

export const firstSettingsPage = settingsPageOrder[0]
