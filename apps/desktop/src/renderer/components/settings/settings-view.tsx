import type { ReactElement } from "react"
import type { Harness } from "@deskto/protocol"

import type { RuntimeQuery } from "../../runtime/use-runtime-query.js"
import { HarnessModelSettings } from "./harness-model-settings.js"
import { HarnessSettings } from "./harness-settings.js"
import { settingsPages, type SettingsPageId } from "./settings-pages.js"
import { ShortcutSettings } from "./shortcut-settings.js"

export function SettingsView({
  page,
  harnesses,
}: {
  page: SettingsPageId
  harnesses: RuntimeQuery<Harness[]>
}) {
  const current = settingsPages[page]

  return (
    <>
      <header className="drag-region h-10 shrink-0" />

      {/* Keyed on the page so each one opens at the top rather than wherever
          the previous page happened to be scrolled to. */}
      <div key={page} className="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
        <div className="mx-auto w-full max-w-2xl">
          <h1 className="font-heading text-2xl font-medium">{current.label}</h1>
          <p className="pt-1 pb-6 text-sm text-muted-foreground">
            {current.description}
          </p>

          <SettingsPane page={page} harnesses={harnesses} />
        </div>
      </div>
    </>
  )
}

/** Returns an element per page, so a new page id cannot fall through to
    whichever pane happens to be last. */
function SettingsPane({
  page,
  harnesses,
}: {
  page: SettingsPageId
  harnesses: RuntimeQuery<Harness[]>
}): ReactElement {
  switch (page) {
    case "agents":
      return <HarnessSettings harnesses={harnesses} />
    case "models":
      return <HarnessModelSettings harnesses={harnesses} />
    case "shortcuts":
      return <ShortcutSettings />
  }
}
