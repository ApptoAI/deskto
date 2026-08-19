import { useEffect, useRef } from "react"
import ArrowLeftIcon from "lucide-react/dist/esm/icons/arrow-left"
import type { WorkspaceLayout } from "@deskto/settings"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import {
  SidebarFrame,
  sidebarRowIdle,
  sidebarRowSelected,
} from "../sidebar/sidebar-frame.js"
import {
  settingsPageOrder,
  settingsPages,
  type SettingsPageId,
} from "./settings-pages.js"

/**
 * Replaces the task sidebar while Settings is open, so the whole window is one
 * screen rather than a panel layered over the tasks the user left behind.
 */
export function SettingsSidebar({
  page,
  workspaceLayout,
  onSelectPage,
  onGoBack,
}: {
  page: SettingsPageId
  workspaceLayout: WorkspaceLayout
  onSelectPage: (page: SettingsPageId) => void
  onGoBack: () => void
}) {
  // Opening Settings unmounts the button that had focus, which would otherwise
  // drop the caret on the body and restart tabbing at the top of the document.
  const goBack = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    goBack.current?.focus()
  }, [])

  return (
    <SidebarFrame
      width={workspaceLayout === "slack" ? "rail-stack" : "default"}
    >
      <div className="no-drag px-2 pb-3">
        <Button
          ref={goBack}
          variant="ghost"
          size="lg"
          className="w-full justify-start"
          onClick={onGoBack}
        >
          <ArrowLeftIcon
            data-icon="inline-start"
            className="text-muted-foreground"
          />
          Go back
        </Button>
      </div>

      {/* The nav below is already labelled "Settings" for screen readers; this
          is the same word drawn for everyone else. */}
      <div aria-hidden className="no-drag px-4 pt-1 pb-2">
        <span className="eyebrow text-muted-foreground">Settings</span>
      </div>

      <nav aria-label="Settings" className="no-drag min-h-0 flex-1 px-2">
        <ul className="space-y-0.5">
          {settingsPageOrder.map((id) => {
            const entry = settingsPages[id]
            const selected = id === page
            const Icon = entry.icon
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => onSelectPage(id)}
                  aria-current={selected ? "page" : undefined}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm",
                    "transition-[background-color,box-shadow,scale] duration-150 ease-out outline-none",
                    "focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]",
                    selected
                      ? sidebarRowSelected
                      : cn("text-foreground/90", sidebarRowIdle)
                  )}
                >
                  <Icon
                    className={cn(
                      "size-3.5 shrink-0",
                      selected ? "text-foreground" : "text-muted-foreground"
                    )}
                  />
                  {entry.label}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
    </SidebarFrame>
  )
}
