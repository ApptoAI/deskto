import type { ExecutionProfile } from "@deskto/protocol"

import {
  DEFAULT_EFFORT,
  effortLabel,
  findModel,
  withModel,
  type HarnessModel,
} from "../../lib/execution-profile.js"
import { HarnessLogo } from "../brand-logos.js"
import { permissionOptions, toPermissionMode } from "./permission-modes.js"
import { ProfileMenu, type ProfileOption } from "./profile-menu.js"
import {
  DefaultThinkingIcon,
  effortRank,
  ThinkingIcon,
} from "./thinking-icons.js"

export function ExecutionProfileToolbar({
  models,
  profile,
  onChange,
  harnessId,
  disabled = false,
  modelMenuOpen,
  onModelMenuOpenChange,
}: {
  models: HarnessModel[]
  profile: ExecutionProfile
  onChange: (profile: ExecutionProfile) => void
  /** Draws the provider logo beside the model; omitted, the row stays plain. */
  harnessId?: string | null
  disabled?: boolean
  modelMenuOpen?: boolean
  onModelMenuOpenChange?: (open: boolean) => void
}) {
  const model = findModel(models, profile.modelId) ?? models[0]
  if (!model) return null

  const modelIcon = harnessId ? (
    <HarnessLogo harnessId={harnessId} className="size-4" />
  ) : undefined

  // Every option says what it changes, because the trigger cannot: a row of
  // bare values is four words with nothing to say which question each answers.
  const thinkingOptions: ProfileOption[] = [
    {
      value: DEFAULT_EFFORT,
      label: effortLabel(DEFAULT_EFFORT),
      description: "However much this model thinks on its own.",
      icon: <DefaultThinkingIcon />,
    },
    ...model.supportedEfforts.map((effort) => {
      const option: ProfileOption = {
        value: effort,
        label: effortLabel(effort),
        icon: (
          <ThinkingIcon level={effortRank(effort, model.supportedEfforts)} />
        ),
      }
      // Only the ends of the scale carry one; the middle rungs stay bare.
      const description = thinkingDescription(effort, model.supportedEfforts)
      if (description) option.description = description
      return option
    }),
  ]

  const permissionModeOptions = permissionOptions.filter((option) =>
    model.supportedPermissionModes.includes(option.value)
  )

  return (
    <div className="flex min-w-0 items-center gap-2">
      {/* The model carries the longest label, so it gives it up first: three
          times the shrink factor of its neighbours, which means "High" and
          "Auto" are still readable at widths where the model name is not. */}
      <ProfileMenu
        label="Model"
        value={model.id}
        triggerClassName="shrink-[3]"
        disabled={disabled}
        open={modelMenuOpen}
        onOpenChange={onModelMenuOpenChange}
        options={models.map((candidate) => ({
          value: candidate.id,
          label: candidate.name,
          description: candidate.description,
          icon: modelIcon,
        }))}
        onSelect={(modelId) => {
          const next = findModel(models, modelId)
          if (next) onChange(withModel(profile, next))
        }}
      />
      {model.supportedEfforts.length > 0 ? (
        <>
          <Divider />
          <ProfileMenu
            label="Thinking"
            value={profile.effort ?? DEFAULT_EFFORT}
            labelClassName={compactLabel}
            disabled={disabled}
            options={thinkingOptions}
            onSelect={(effort) =>
              onChange({
                ...profile,
                effort: effort === DEFAULT_EFFORT ? null : effort,
              })
            }
          />
        </>
      ) : null}
      <Divider />
      <ProfileMenu
        label="Permissions"
        value={profile.permissionMode}
        labelClassName={compactLabel}
        disabled={disabled}
        options={permissionModeOptions}
        onSelect={(value) =>
          onChange({ ...profile, permissionMode: toPermissionMode(value) })
        }
      />
    </div>
  )
}

/**
 * Thinking and permissions are one or two words — "Auto", "Full access",
 * "Extra high" — and truncated they read as "A" and "Full acce…", which says
 * less than the icon beside them already does. So they are shown whole or not
 * at all, on the composer's own width rather than the window's.
 *
 * The threshold is where the longest of them fit *without squeezing the model
 * name*: measured at 572px for "Extra high" with "Full access", 581px for the
 * longest thinking label a model may offer. Below it the model has the row to
 * itself and truncates only when its own name is long; above it, nothing
 * truncates. Anything lower and widening the panel would make the model name
 * shorter, which is the wrong way round.
 */
const compactLabel = "hidden @[37rem]:inline"

function Divider() {
  return <span aria-hidden className="h-4 w-px shrink-0 bg-border" />
}

/**
 * What more thinking buys, in the terms the person paid in: time. Only the
 * ends of the scale get a line — one sentence repeated down three middle
 * rungs would claim they are the same choice, and the bars beside them
 * already say which is deeper. Position is read off the harness's own order
 * rather than the effort's name, since providers invent their own top rung.
 */
function thinkingDescription(
  effort: string,
  efforts: readonly string[]
): string | undefined {
  if (effort === "none") return "No extra reasoning. Fastest."
  const ranked = efforts.filter((candidate) => candidate !== "none")
  if (ranked.length < 2) return undefined
  if (effort === ranked[0]) return "A quick pass. Best for small, clear tasks."
  if (effort === ranked[ranked.length - 1]) {
    return "The most reasoning this model offers. Slowest."
  }
  return undefined
}
