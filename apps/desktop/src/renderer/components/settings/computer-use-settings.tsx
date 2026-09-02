import { Button } from "@workspace/ui/components/button"

import { useSettings } from "../../settings/settings-context.js"
import { StatusPanel } from "../status-panel.js"
import { computerUseSections } from "./computer-use-sections.js"

export function ComputerUseSettings() {
  const { loadError, retry } = useSettings()

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

  return (
    <section aria-label="Computer use" className="space-y-4">
      {computerUseSections.map((section) => (
        <fieldset
          key={section.id}
          className="rounded-lg border border-border p-4"
        >
          <legend className="px-1 eyebrow text-muted-foreground">
            {section.label}
          </legend>
          <p className="pt-1 pb-3 text-xs leading-snug text-muted-foreground">
            {section.description}
          </p>
          <section.Component />
        </fieldset>
      ))}
    </section>
  )
}
