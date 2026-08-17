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
  /** Stable app-owned identity, normally the Pack id. */
  id?: string
  /** Absolute path to a directory whose children are SKILL.md skill folders. */
  path: string
  /** Human-readable source label, e.g. the pack name. */
  name: string
  /** Digest recorded when Deskto installed the Pack, when available. */
  contentDigest?: string
}

export type SkillProvisioningStatus = "configured" | "unsupported" | "failed"

/** Adapter-owned identifier for the native mechanism it used. */
export type SkillProvisioningMethod = string

/** What one Adapter did with one app-supplied skill root for this session. */
export type SkillProvisioningResult = {
  rootId: string
  rootPath: string
  contentDigest?: string
  status: SkillProvisioningStatus
  method: SkillProvisioningMethod
  message?: string
}

/** A Runtime-provided Streamable HTTP MCP server for one Harness session. */
export type SessionMcpServer = {
  /** Stable server id. Adapters use it as the provider-native MCP name. */
  id: string
  url: string
  authorization?: { type: "bearer"; token: string }
}

export type SkillDiscoveryInput = {
  /** Project directory used as the Harness working directory, when relevant. */
  projectPath: string | null
}

/** A native filesystem location from which one Harness discovers skills. */
export type NativeSkillRoot = {
  path: string
  scope: "project" | "user" | "admin"
  label: string
}

/**
 * Provider-neutral additions to a session, built by the Runtime from the
 * active workspace's Packs. Adapters translate it to native mechanisms and
 * report whether each root was configured, unsupported, or failed.
 */
export type SessionCustomization = {
  skillRoots: SkillRoot[]
  /** Host capabilities leased for this run. Omitted by older Runtime hosts. */
  mcpServers?: SessionMcpServer[]
}

/** A reference already validated and resolved by the Runtime. */
export type HarnessPromptReference =
  | {
      kind: "project-entry"
      name: string
      path: string
      entryKind: "file" | "directory"
    }
  | {
      kind: "skill"
      /** A Pack skill is reached through the shim Deskto builds; a native one
          is already installed in the agent's own folder. */
      origin: "pack" | "native"
      name: string
      path: string
    }

export type HarnessImageAttachment = {
  type: "image"
  name: string
  mimeType: "image/gif" | "image/jpeg" | "image/png" | "image/webp"
  dataUrl: string
}

export type HarnessRunInput = {
  threadId: string
  turnId: string
  projectPath: string
  prompt: string
  references: HarnessPromptReference[]
  /** Image inputs already validated by the Runtime. */
  attachments?: HarnessImageAttachment[]
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
  /** Root configuration completed before the session was returned. */
  readonly skillProvisioning?: SkillProvisioningResult[]
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
  /** Filesystem roots the Harness would inspect for this project. */
  discoverSkillRoots?(input: SkillDiscoveryInput): Promise<NativeSkillRoot[]>
  start(input: HarnessRunInput, signal: AbortSignal): Promise<HarnessSession>
  /** Optional because not every Harness can safely run stateless generation. */
  generateText?(
    input: TextGenerationInput,
    signal: AbortSignal
  ): Promise<string>
}
