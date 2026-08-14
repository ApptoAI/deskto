import type { ExecutionProfile, Harness } from "@openappto/protocol"

export type HarnessModel = Harness["models"][number]

export function findModel(
  models: HarnessModel[],
  modelId: string | null
): HarnessModel | null {
  if (!modelId) return null
  return models.find((model) => model.id === modelId) ?? null
}

export function defaultExecutionProfile(
  models: HarnessModel[]
): ExecutionProfile {
  const model = models.find((candidate) => candidate.isDefault) ?? models[0]
  return {
    modelId: model?.id ?? null,
    effort: model ? keptEffort(model, null) : null,
    permissionMode: "approval-required",
  }
}

export function withModel(
  profile: ExecutionProfile,
  model: HarnessModel
): ExecutionProfile {
  return {
    ...profile,
    modelId: model.id,
    effort: keptEffort(model, profile.effort),
    permissionMode: keptPermissionMode(model, profile.permissionMode),
  }
}

function keptEffort(model: HarnessModel, effort: string | null): string | null {
  const supported = model.supportedEfforts
  if (effort && supported.includes(effort)) return effort
  if (model.defaultEffort && supported.includes(model.defaultEffort)) {
    return model.defaultEffort
  }
  return null
}

function keptPermissionMode(
  model: HarnessModel,
  mode: ExecutionProfile["permissionMode"]
): ExecutionProfile["permissionMode"] {
  const supported = model.supportedPermissionModes
  if (supported.includes(mode)) return mode
  if (supported.includes("approval-required")) return "approval-required"
  return supported[0] ?? mode
}

/** Sentinel for "use the model's native default", stored as effort: null. */
export const DEFAULT_EFFORT = "__default__"

const effortLabels: Record<string, string> = {
  [DEFAULT_EFFORT]: "Default",
  xhigh: "Extra high",
  none: "No thinking",
}

export function effortLabel(effort: string): string {
  return (
    effortLabels[effort] ?? effort.charAt(0).toUpperCase() + effort.slice(1)
  )
}
