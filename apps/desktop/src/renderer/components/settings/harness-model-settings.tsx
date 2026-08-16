import { useState } from "react"
import type { Harness } from "@deskto/protocol"
import {
  harnessModelSettings,
  isOverridden,
  settingValue,
  type HarnessModelSelection,
  type SettingDefinition,
} from "@deskto/settings"

import { Button } from "@workspace/ui/components/button"

import { describedErrorSchema } from "../../runtime/describe-error.js"
import type { RuntimeQuery } from "../../runtime/use-runtime-query.js"
import { useSettings } from "../../settings/settings-context.js"
import { HarnessLogo } from "../brand-logos.js"
import {
  ProfileMenu,
  type ProfileOption,
} from "../execution-profile/profile-menu.js"
import { InlineError } from "../inline-error.js"
import { StatusPanel } from "../status-panel.js"

const taskModelSelection = {
  harnessId: null,
  modelId: null,
} satisfies HarnessModelSelection

export function HarnessModelSettings({
  harnesses,
}: {
  harnesses: RuntimeQuery<Harness[]>
}) {
  return (
    <section aria-label="Generated text settings" className="space-y-3">
      {/* Without the agent list these menus quietly shrink to "Same as task",
          and the Agents page is the only other place that says why. */}
      {harnesses.state.status === "error" ? (
        <StatusPanel
          title="Deskto cannot read the list of agents"
          description={harnesses.state.message}
          tone="danger"
        >
          <Button variant="outline" onClick={harnesses.revalidate}>
            Try again
          </Button>
        </StatusPanel>
      ) : null}

      <div className="divide-y divide-border rounded-lg border border-border">
        {harnessModelSettings.map((definition) => (
          <HarnessModelRow
            key={definition.key}
            definition={definition}
            harnesses={harnesses}
          />
        ))}
      </div>
    </section>
  )
}

function HarnessModelRow({
  definition,
  harnesses,
}: {
  definition: SettingDefinition<HarnessModelSelection>
  harnesses: RuntimeQuery<Harness[]>
}) {
  const { snapshot, update } = useSettings()
  const [actionError, setActionError] = useState<string | null>(null)
  const selection = settingValue(snapshot, definition)
  const options = modelOptions(harnesses, selection)

  async function apply(next: HarnessModelSelection | null) {
    setActionError(null)
    try {
      await update({ [definition.key]: next })
    } catch (error) {
      setActionError(describedErrorSchema.parse(error))
    }
  }

  return (
    <div className="space-y-2 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium">{definition.label}</span>
          <p className="pt-0.5 text-xs leading-snug text-muted-foreground">
            {definition.description}
          </p>
        </div>

        {isOverridden(snapshot, definition) ? (
          <Button variant="ghost" size="sm" onClick={() => apply(null)}>
            Reset
          </Button>
        ) : null}

        <div className="max-w-64 rounded-md border border-border">
          <ProfileMenu
            label={definition.label}
            value={selectionKey(selection)}
            options={options}
            onSelect={(value) => {
              const selected = options.find((option) => option.value === value)
              if (!selected) return
              void apply(
                selectionKey(selected.selection) ===
                  selectionKey(definition.defaultValue)
                  ? null
                  : selected.selection
              )
            }}
          />
        </div>
      </div>
      {actionError ? <InlineError message={actionError} /> : null}
    </div>
  )
}

type HarnessModelOption = ProfileOption & {
  selection: HarnessModelSelection
}

function modelOptions(
  harnesses: RuntimeQuery<Harness[]>,
  selected: HarnessModelSelection
): HarnessModelOption[] {
  const options: HarnessModelOption[] = [
    {
      value: selectionKey(taskModelSelection),
      label: "Same as task",
      description: "Uses the task's agent and selected model.",
      selection: taskModelSelection,
    },
  ]
  if (harnesses.state.status === "ready") {
    for (const harness of harnesses.state.data) {
      if (!harness.enabled || harness.availability.status !== "available")
        continue
      for (const model of harness.models) {
        if (!model.supportedPermissionModes.includes("approval-required"))
          continue
        const selection = {
          harnessId: harness.id,
          modelId: model.id,
        } satisfies HarnessModelSelection
        options.push({
          value: selectionKey(selection),
          label: `${harness.name} · ${model.name}`,
          description: model.description,
          icon: <HarnessLogo harnessId={harness.id} className="size-4" />,
          selection,
        })
      }
    }
  }

  const selectedValue = selectionKey(selected)
  if (!options.some((option) => option.value === selectedValue)) {
    options.push({
      value: selectedValue,
      label: `${selected.harnessId} · ${selected.modelId ?? "Default model"}`,
      description: "This saved model is not currently available.",
      selection: selected,
    })
  }
  return options
}

function selectionKey(selection: HarnessModelSelection): string {
  return JSON.stringify(selection)
}
