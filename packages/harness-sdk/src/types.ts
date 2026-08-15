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

/** A reference already validated and resolved by the Runtime. */
export type HarnessPromptReference =
  | {
      kind: "project-entry"
      name: string
      path: string
      entryKind: "file" | "directory"
    }
  | { kind: "skill"; name: string; path: string }

export type HarnessRunInput = {
  threadId: string
  turnId: string
  projectPath: string
  prompt: string
  references: HarnessPromptReference[]
  executionProfile: ExecutionProfile
  customization: SessionCustomization
  providerSessionId?: string
}

/** One stateless model call for small app-owned text, such as a Thread title. */
export type TextGenerationInput = {
  projectPath: string
  prompt: string
  executionProfile: ExecutionProfile
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

export type PlanStepStatus = "pending" | "active" | "done"

export type PlanStep = { text: string; status: PlanStepStatus }

export type ChangedFile = {
  path: string
  additions?: number
  deletions?: number
}

/**
 * Provider-neutral classification of one Activity. Adapters map their native
 * item vocabulary into these kinds; an Activity without a payload is a plain
 * labeled row. Payloads stay bounded summaries — no transcripts, no raw tool
 * output.
 */
export type ActivityPayload =
  | { kind: "tool"; tool: "command" | "search" | "web" | "mcp" | "other" }
  | { kind: "file-change"; files: ChangedFile[] }
  | { kind: "plan"; steps: PlanStep[] }
  | { kind: "subagent"; agentType?: string }

export type ActivityStart = {
  id: string
  name: string
  detail?: string
  payload?: ActivityPayload
  /** Provider id of the Activity this one runs inside, e.g. a subagent. */
  parentId?: string
}

export type ActivityUpdate = {
  id: string
  name?: string
  detail?: string
  payload?: ActivityPayload
}

export type HarnessEvent =
  | { type: "session.started"; providerSessionId: string }
  | { type: "message.delta"; text: string }
  | { type: "usage.updated"; usage: ContextUsage }
  | { type: "activity.started"; activity: ActivityStart }
  | { type: "activity.updated"; update: ActivityUpdate }
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
  /** Optional because not every Harness can safely run stateless generation. */
  generateText?(
    input: TextGenerationInput,
    signal: AbortSignal
  ): Promise<string>
}
