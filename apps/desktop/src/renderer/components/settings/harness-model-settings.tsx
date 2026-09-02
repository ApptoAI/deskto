import { useState } from "react"
import type { Harness } from "@deskto/protocol"
import {
  appSettings,
  harnessModelSettings,
  isOverridden,
  isHarnessModelVisible,
  settingValue,
  type HarnessModelVisibility,
  type HarnessModelSelection,
  type SettingDefinition,
} from "@deskto/settings"

import { Button } from "@workspace/ui/components/button"
import { Switch } from "@workspace/ui/components/switch"

import { knownHarnessLabel } from "../../lib/harness.js"
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
    <section aria-label="Model settings" className="space-y-6">
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

      <ModelVisibilitySettings harnesses={harnesses} />

      <div className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">Generated text</h2>
          <p className="pt-0.5 text-xs text-muted-foreground">
            Choose the model Deskto uses for text it creates automatically.
          </p>
        </div>
        <div className="divide-y divide-border rounded-lg border border-border">
          {harnessModelSettings.map((definition) => (
            <HarnessModelRow
              key={definition.key}
              definition={definition}
              harnesses={harnesses}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

function ModelVisibilitySettings({
  harnesses,
}: {
  harnesses: RuntimeQuery<Harness[]>
}) {
  const { snapshot, update } = useSettings()
  const [actionError, setActionError] = useState<string | null>(null)
  const visibility = settingValue(snapshot, appSettings.modelVisibility)
  const providers =
    harnesses.state.status === "ready"
      ? harnesses.state.data.filter((harness) => harness.models.length > 0)
      : []

  async function setVisible(
    harness: Harness,
    modelId: string,
    visible: boolean
  ) {
    const hidden = visibility[harness.id] ?? []
    const nextHidden = visible
      ? hidden.filter((id) => id !== modelId)
      : [...hidden, modelId]
    const next: HarnessModelVisibility = {
      ...visibility,
      [harness.id]: nextHidden,
    }
    if (nextHidden.length === 0) delete next[harness.id]

    setActionError(null)
    try {
      await update({
        [appSettings.modelVisibility.key]:
          Object.keys(next).length === 0 ? null : next,
      })
    } catch (error) {
      setActionError(describedErrorSchema.parse(error))
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">Providers</h2>
        <p className="pt-0.5 text-xs text-muted-foreground">
          Choose which models appear when you configure a task. Each provider
          keeps at least one visible model.
        </p>
      </div>
      {providers.map((harness) => {
        const visibleCount = harness.models.filter((model) =>
          isHarnessModelVisible(visibility, harness.id, model.id)
        ).length
        return (
          <div
            key={harness.id}
            className="overflow-hidden rounded-lg border border-border"
          >
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <HarnessLogo harnessId={harness.id} className="size-4" />
              <h3 className="text-sm font-medium">{harness.name}</h3>
            </div>
            <ul className="divide-y divide-border">
              {harness.models.map((model) => {
                const visible = isHarnessModelVisible(
                  visibility,
                  harness.id,
                  model.id
                )
                return (
                  <li
                    key={model.id}
                    className="flex items-center gap-4 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{model.name}</p>
                      {model.description ? (
                        <p className="truncate pt-0.5 text-xs text-muted-foreground">
                          {model.description}
                        </p>
                      ) : null}
                    </div>
                    <Switch
                      aria-label={`Show ${model.name} for ${harness.name}`}
                      checked={visible}
                      disabled={visible && visibleCount === 1}
                      onCheckedChange={(checked) =>
                        void setVisible(harness, model.id, checked)
                      }
                    />
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
      {actionError ? <InlineError message={actionError} /> : null}
    </div>
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
  const visibility = settingValue(snapshot, appSettings.modelVisibility)
  const options = modelOptions(harnesses, selection, visibility)

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
            contentClassName="max-h-80"
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
  selected: HarnessModelSelection,
  visibility: HarnessModelVisibility
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
        if (!isHarnessModelVisible(visibility, harness.id, model.id)) continue
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
      label: `${knownHarnessLabel(selected.harnessId ?? "")} · ${selected.modelId ?? "Default model"}`,
      description:
        "This saved model is not offered right now. Show it above, turn its agent on under Agents, or pick another model.",
      selection: selected,
    })
  }
  return options
}

function selectionKey(selection: HarnessModelSelection): string {
  return JSON.stringify(selection)
}
