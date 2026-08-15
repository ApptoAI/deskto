import type { ExecutionProfile } from "@openappto/protocol"

import {
  DEFAULT_EFFORT,
  effortLabel,
  findModel,
  withModel,
  type HarnessModel,
} from "../../lib/execution-profile.js"
import { HarnessLogo } from "../brand-logos.js"
import { permissionOptions, toPermissionMode } from "./permission-modes.js"
import { ProfileMenu } from "./profile-menu.js"
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
}: {
  models: HarnessModel[]
  profile: ExecutionProfile
  onChange: (profile: ExecutionProfile) => void
  /** Draws the provider logo beside the model; omitted, the row stays plain. */
  harnessId?: string | null
  disabled?: boolean
}) {
  const model = findModel(models, profile.modelId) ?? models[0]
  if (!model) return null

  const modelIcon = harnessId ? (
    <HarnessLogo harnessId={harnessId} className="size-4" />
  ) : undefined

  const thinkingOptions = [
    {
      value: DEFAULT_EFFORT,
      label: effortLabel(DEFAULT_EFFORT),
      icon: <DefaultThinkingIcon />,
    },
    ...model.supportedEfforts.map((effort) => ({
      value: effort,
      label: effortLabel(effort),
      icon: <ThinkingIcon level={effortRank(effort, model.supportedEfforts)} />,
    })),
  ]

  const permissionModeOptions = permissionOptions.filter((option) =>
    model.supportedPermissionModes.includes(option.value)
  )

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <ProfileMenu
        label="Model"
        value={model.id}
        disabled={disabled}
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
        disabled={disabled}
        options={permissionModeOptions}
        onSelect={(value) =>
          onChange({ ...profile, permissionMode: toPermissionMode(value) })
        }
      />
    </div>
  )
}

function Divider() {
  return <span aria-hidden className="h-4 w-px shrink-0 bg-border" />
}
