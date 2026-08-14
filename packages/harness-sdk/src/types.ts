export type HarnessDescriptor = {
  id: string
  name: string
}

export type HarnessAvailability =
  | { status: "available"; version?: string }
  | { status: "unavailable"; reason: string }

export type ReasoningEffort = string

export type PermissionMode = "approval-required" | "auto" | "full-access"

export type ExecutionProfile = {
  modelId: string | null
  effort: ReasoningEffort | null
  permissionMode: PermissionMode
}

export type HarnessModelOption = {
  id: string
  name: string
  description?: string
  supportedEfforts: ReasoningEffort[]
  defaultEffort?: ReasoningEffort
  isDefault: boolean
  supportedPermissionModes: PermissionMode[]
}

/** A directory of SKILL.md skill folders, labeled by whoever owns its metadata. */
export type SkillRoot = {
  /** Absolute path to a directory whose children are SKILL.md skill folders. */
  path: string
  /** Human-readable source label, e.g. the pack name. */
  name: string
}

/**
 * Provider-neutral additions to a session, built by the Runtime from the
 * active workspace's Packs. Adapters translate it to native mechanisms and
 * silently skip what the installed harness version cannot honor.
 */
export type SessionCustomization = {
  skillRoots: SkillRoot[]
}

export type HarnessRunInput = {
  threadId: string
  turnId: string
  projectPath: string
  prompt: string
  executionProfile: ExecutionProfile
  customization: SessionCustomization
  providerSessionId?: string
}

export type ApprovalKind = "command" | "file-change" | "tool"

export type ApprovalRequest = {
  id: string
  kind: ApprovalKind
  title: string
  detail?: string
}

export type ApprovalDecision = "approve" | "deny"

export type ContextUsage = {
  usedTokens: number
  maxTokens?: number
}

export type HarnessFailureKind = "usage-limit" | "error"

/** Provider-neutral reason why a Harness could not finish a Turn. */
export type HarnessFailure = {
  kind: HarnessFailureKind
  message: string
  /** ISO timestamp reported by the Harness, when it provides one. */
  resetAt?: string
}

export type HarnessEvent =
  | { type: "session.started"; providerSessionId: string }
  | { type: "message.delta"; text: string }
  | { type: "usage.updated"; usage: ContextUsage }
  | {
      type: "activity.started"
      activity: { id: string; name: string; detail?: string }
    }
  | {
      type: "activity.completed"
      id: string
      outcome: "completed" | "failed"
    }
  | { type: "approval.requested"; request: ApprovalRequest }
  | { type: "turn.completed" }
  | { type: "turn.failed"; failure: HarnessFailure }

export interface HarnessSession {
  /** Emits at most one unresolved approval request at a time. */
  readonly events: AsyncIterable<HarnessEvent>
  cancel(): Promise<void>
  respondToApproval(
    approvalId: string,
    decision: ApprovalDecision
  ): Promise<void>
}

export interface HarnessAdapterFactory {
  readonly descriptor: HarnessDescriptor
  checkAvailability(): Promise<HarnessAvailability>
  listModels(): Promise<HarnessModelOption[]>
  start(input: HarnessRunInput, signal: AbortSignal): Promise<HarnessSession>
}
