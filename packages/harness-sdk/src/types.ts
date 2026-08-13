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

export type HarnessRunInput = {
  threadId: string
  turnId: string
  workspacePath: string
  prompt: string
  executionProfile: ExecutionProfile
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

export type HarnessEvent =
  | { type: "session.started"; providerSessionId: string }
  | { type: "message.delta"; text: string }
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
  | { type: "turn.failed"; message: string }

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
