import { useState } from "react"
import {
  findKeybindingConflict,
  formatKeybinding,
  isOverridden,
  keybindingFromEvent,
  keybindingSettings,
  settingValue,
  type Platform,
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
  const platform = keyboardPlatform()

  async function apply(entries: SettingValues) {
    setActionError(null)
    try {
      await update(entries)
    } catch (error) {
      setActionError(describedErrorSchema.parse(error))
    }
  }

  function record(definition: SettingDefinition<string>, binding: string) {
    const taken = findKeybindingConflict(snapshot, definition, binding)
    if (taken) {
      setActionError(
        `${formatKeybinding(binding, platform)} already opens “${taken.label}”. Press a different combination, or reset that shortcut first.`
      )
      return
    }
    void apply({ [definition.key]: binding })
  }

  return (
    <section aria-label="Keyboard shortcuts" className="space-y-3">
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
              platform={platform}
              onRecord={(binding) => record(definition, binding)}
              onReset={() => void apply({ [definition.key]: null })}
              onReject={setActionError}
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
  platform,
  onRecord,
  onReset,
  onReject,
}: {
  definition: SettingDefinition<string>
  value: string
  overridden: boolean
  platform: Platform
  onRecord: (binding: string) => void
  onReset: () => void
  /** A keydown the recorder cannot turn into a binding, explained. */
  onReject: (message: string) => void
}) {
  const [recording, setRecording] = useState(false)
  const commandKey = platform === "mac" ? "⌘" : "Ctrl"

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

      {/* Stays mounted while recording so the row does not jump; hidden
          instead so a stray press cannot land on it. */}
      <Button
        variant="ghost"
        size="sm"
        className={cn(!overridden && "hidden", recording && "invisible")}
        onClick={onReset}
      >
        Reset
      </Button>

      <Button
        variant="outline"
        size="sm"
        className={cn(
          "min-w-24 font-mono tabular-nums",
          recording && "border-input ring-2 ring-ring/30"
        )}
        aria-label={`Change shortcut for ${definition.label}`}
        aria-pressed={recording}
        onClick={() => setRecording(true)}
        onBlur={() => setRecording(false)}
        onKeyDown={(event) => {
          if (!recording) return
          // Tab keeps its meaning so the keyboard can leave the recorder.
          if (event.key === "Tab") {
            setRecording(false)
            return
          }
          event.preventDefault()
          event.stopPropagation()
          if (event.key === "Escape") {
            setRecording(false)
            return
          }
          const binding = keybindingFromEvent(event, platform)
          if (!binding) {
            if (!isModifierKey(event.key)) {
              onReject(
                `Shortcuts need ${commandKey} or Alt, or a function key, so they cannot fire while you type. Hold one and press again.`
              )
            }
            return
          }
          setRecording(false)
          onRecord(binding)
        }}
      >
        {recording ? "Press keys…" : formatKeybinding(value, platform)}
      </Button>
    </li>
  )
}

/** A modifier on its own is the start of a chord, not a rejected key. */
function isModifierKey(key: string): boolean {
  return (
    key === "Meta" ||
    key === "Control" ||
    key === "Alt" ||
    key === "Shift" ||
    key === "AltGraph"
  )
}
