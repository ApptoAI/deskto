import { useState } from "react"
import {
  formatKeybinding,
  isOverridden,
  keybindingFromEvent,
  keybindingSettings,
  settingValue,
  type SettingDefinition,
  type SettingValues,
} from "@deskto/settings"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { keyboardPlatform } from "../../lib/platform.js"
import { describedErrorSchema } from "../../runtime/describe-error.js"
import { useSettings } from "../../settings/settings-context.js"
import { InlineError } from "../inline-error.js"
import { StatusPanel } from "../status-panel.js"

export function ShortcutSettings() {
  const { snapshot, loadError, retry, update } = useSettings()
  const [actionError, setActionError] = useState<string | null>(null)

  async function apply(entries: SettingValues) {
    setActionError(null)
    try {
      await update(entries)
    } catch (error) {
      setActionError(describedErrorSchema.parse(error))
    }
  }

  return (
    <section aria-label="Keyboard shortcuts" className="space-y-3 pt-10">
      <div>
        <h2 className="text-sm font-medium">Keyboard shortcuts</h2>
        <p className="text-xs text-muted-foreground">
          Click a shortcut, then press the new key combination.
        </p>
      </div>

      {actionError ? <InlineError message={actionError} /> : null}

      {loadError ? (
        <StatusPanel
          title="Deskto cannot read your settings"
          description={loadError}
          tone="danger"
        >
          <Button variant="outline" onClick={retry}>
            Try again
          </Button>
        </StatusPanel>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {keybindingSettings.map((definition) => (
            <ShortcutRow
              key={definition.key}
              definition={definition}
              value={settingValue(snapshot, definition)}
              overridden={isOverridden(snapshot, definition)}
              onApply={(binding) => apply({ [definition.key]: binding })}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function ShortcutRow({
  definition,
  value,
  overridden,
  onApply,
}: {
  definition: SettingDefinition<string>
  value: string
  overridden: boolean
  /** Null clears the override back to the default binding. */
  onApply: (binding: string | null) => void
}) {
  const [recording, setRecording] = useState(false)
  const platform = keyboardPlatform()

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <span className="text-sm font-medium">{definition.label}</span>
        {definition.description ? (
          <p className="pt-0.5 text-xs leading-snug text-muted-foreground">
            {definition.description}
          </p>
        ) : null}
      </div>

      {overridden && !recording ? (
        <Button variant="ghost" size="sm" onClick={() => onApply(null)}>
          Reset
        </Button>
      ) : null}

      <Button
        variant="outline"
        size="sm"
        className={cn(
          "min-w-24 font-mono tabular-nums",
          recording && "border-ring ring-2 ring-ring/30"
        )}
        aria-label={`Change shortcut for ${definition.label}`}
        onClick={() => setRecording(true)}
        onBlur={() => setRecording(false)}
        onKeyDown={(event) => {
          if (!recording) return
          event.preventDefault()
          event.stopPropagation()
          if (event.key === "Escape") {
            setRecording(false)
            return
          }
          const binding = keybindingFromEvent(event, platform)
          if (!binding) return
          setRecording(false)
          onApply(binding)
        }}
      >
        {recording ? "Press keys…" : formatKeybinding(value, platform)}
      </Button>
    </li>
  )
}
