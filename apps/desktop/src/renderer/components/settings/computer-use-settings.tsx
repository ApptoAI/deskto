import { useId, useState } from "react"
import { Button } from "@workspace/ui/components/button"

import { useSettings } from "../../settings/settings-context.js"
import { StatusPanel } from "../status-panel.js"
import { BrowserSettingsSection } from "./computer-use-browser-section.js"
import { computerUseSections } from "./computer-use-sections.js"

export function ComputerUseSettings() {
  const { loadError, retry } = useSettings()
  const [tab, setTab] = useState("browser")
  const tabId = useId()

  if (loadError) {
    return (
      <StatusPanel
        title="Deskto cannot read your settings"
        description={loadError}
        tone="danger"
      >
        <Button variant="outline" onClick={retry}>
          Try again
        </Button>
      </StatusPanel>
    )
  }

  const tabs = [
    { id: "browser", label: "Browser", sections: ["browser"] },
    {
      id: "sign-ins",
      label: "Sign-ins",
      sections: ["profiles", "cookie-import"],
    },
    { id: "computer", label: "Computer", sections: [] },
    { id: "advanced", label: "Advanced", sections: ["screen-control"] },
  ]
  const activeSections: string[] =
    tabs.find((entry) => entry.id === tab)?.sections ?? []

  return (
    <section aria-label="Computer use" className="space-y-6">
      <div
        role="tablist"
        aria-label="Computer use settings"
        className="flex gap-1 overflow-x-auto"
      >
        {tabs.map((entry, index) => (
          <Button
            key={entry.id}
            id={`${tabId}-${entry.id}`}
            role="tab"
            aria-selected={tab === entry.id}
            tabIndex={tab === entry.id ? 0 : -1}
            variant={tab === entry.id ? "secondary" : "ghost"}
            onClick={() => setTab(entry.id)}
            onKeyDown={(event) => {
              const nextIndex =
                event.key === "ArrowRight"
                  ? (index + 1) % tabs.length
                  : event.key === "ArrowLeft"
                    ? (index + tabs.length - 1) % tabs.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? tabs.length - 1
                        : null
              if (nextIndex === null) return
              event.preventDefault()
              const next = tabs[nextIndex]
              if (!next) return
              setTab(next.id)
              document.getElementById(`${tabId}-${next.id}`)?.focus()
            }}
          >
            {entry.label}
          </Button>
        ))}
      </div>
      <div
        id={`${tabId}-panel`}
        role="tabpanel"
        aria-labelledby={`${tabId}-${tab}`}
        className="space-y-6"
      >
        {tab === "computer" ? (
          <section className="space-y-2">
            <p className="eyebrow text-muted-foreground">Coming soon</p>
            <h2 className="text-sm font-medium">Work across your computer</h2>
            <p className="text-sm text-muted-foreground">
              A place to manage access to desktop apps beyond the browser.
              Existing Codex computer-use plugins remain available through
              Codex.
            </p>
          </section>
        ) : null}
        {tab === "advanced" ? (
          <section>
            <h2 className="pb-3 text-sm font-medium">Browser configuration</h2>
            <BrowserSettingsSection advanced />
          </section>
        ) : null}
        {computerUseSections
          .filter((section) => activeSections.includes(section.id))
          .map((section) => (
            <section key={section.id}>
              <h2 className="text-sm font-medium">{section.label}</h2>
              <p className="pt-1 pb-3 text-xs leading-snug text-muted-foreground">
                {section.description}
              </p>
              <section.Component />
            </section>
          ))}
      </div>
    </section>
  )
}
