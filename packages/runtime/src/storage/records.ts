import {
  activityPayloadSchema,
  promptReferenceSchema,
  type Activity,
  type Approval,
  type Message,
  type ImageAttachment,
  type PackKind,
  type PackReceipt,
  type Thread,
  type Project,
  type Workspace,
  packReceiptSchema,
} from "@deskto/protocol"

export type WorkspaceRow = {
  id: string
  name: string
  color: string
  icon: string
  sort_order: number
  created_at: string
  updated_at: string
}

export type ProjectRow = {
  id: string
  workspace_id: string
  name: string
  path: string
  created_at: string
  updated_at: string
}

export type ThreadRow = {
  id: string
  project_id: string
  title: string
  harness_id: string
  status: Thread["status"]
  provider_session_id: string | null
  model_id: string | null
  effort: Thread["executionProfile"]["effort"]
  permission_mode: Thread["executionProfile"]["permissionMode"]
  context_used_tokens: number | null
  context_max_tokens: number | null
  last_user_message_at: string | null
  last_turn_completed_at: string | null
  last_visited_at: string | null
  failed_at: string | null
  pinned_at: string | null
  snoozed_until: string | null
  snoozed_at: string | null
  done_override: Thread["doneOverride"]
  done_at: string | null
  created_at: string
  updated_at: string
}

export type MessageRow = {
  id: string
  thread_id: string
  turn_id: string | null
  role: Message["role"]
  content: string
  prompt_references: string | null
  state: Message["state"]
  error: string | null
  failure_kind: "usage-limit" | "error" | null
  failure_reset_at: string | null
  ordinal: number | null
  created_at: string
}

export type MessageAttachmentMetadataRow = {
  id: string
  message_id: string
  type: "image"
  name: string
  mime_type: ImageAttachment["mimeType"]
  size_bytes: number
  sort_order: number
}

export type MessageAttachmentRow = MessageAttachmentMetadataRow & {
  data: Uint8Array
}

export type ActivityRow = {
  id: string
  thread_id: string
  turn_id: string
  name: string
  detail: string | null
  status: Activity["status"]
  payload: string | null
  parent_id: string | null
  ordinal: number | null
  created_at: string
  finished_at: string | null
}

export type ApprovalRow = {
  id: string
  thread_id: string
  kind: Approval["kind"]
  title: string
  detail: string | null
  status: Approval["status"]
  created_at: string
}

export function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    icon: row.icon,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export type PackRow = {
  id: string
  name: string
  path: string
  kind: PackKind
  content_digest: string | null
  receipt_json: string | null
  created_at: string
  updated_at: string
}

/** The database half of a Pack; skills and attachments are composed on top. */
export function toPackRecord(row: PackRow) {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    kind: row.kind,
    contentDigest: row.content_digest,
    receipt: parsePackReceipt(row.receipt_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function parsePackReceipt(value: string | null): PackReceipt | null {
  if (!value) return null
  try {
    const parsed = packReceiptSchema.safeParse(JSON.parse(value))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    path: row.path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function toThread(row: ThreadRow): Thread {
  let contextUsage: Thread["contextUsage"]
  if (row.context_used_tokens !== null) {
    contextUsage = { usedTokens: row.context_used_tokens }
    if (row.context_max_tokens !== null) {
      contextUsage.maxTokens = row.context_max_tokens
    }
  }
  const thread: Thread = {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    harnessId: row.harness_id,
    status: row.status,
    executionProfile: {
      modelId: row.model_id,
      effort: row.effort,
      permissionMode: row.permission_mode,
    },
    lastUserMessageAt: row.last_user_message_at,
    lastTurnCompletedAt: row.last_turn_completed_at,
    lastVisitedAt: row.last_visited_at,
    failedAt: row.failed_at,
    pinnedAt: row.pinned_at,
    snoozedUntil: row.snoozed_until,
    snoozedAt: row.snoozed_at,
    doneOverride: row.done_override,
    doneAt: row.done_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
  if (contextUsage) thread.contextUsage = contextUsage
  return thread
}

export function toMessage(
  row: MessageRow,
  attachments: ImageAttachment[] = []
): Message {
  let failure: Message["failure"]
  if (row.error) {
    failure = {
      kind: row.failure_kind ?? ("error" as const),
      message: row.error,
    }
    if (row.failure_reset_at) failure.resetAt = row.failure_reset_at
  }
  const message: Message = {
    id: row.id,
    threadId: row.thread_id,
    role: row.role,
    content: row.content,
    state: row.state,
    createdAt: row.created_at,
  }
  if (row.turn_id) message.turnId = row.turn_id
  const references = parsedPromptReferences(row.prompt_references)
  if (references) message.references = references.references
  if (attachments.length > 0) message.attachments = attachments
  if (failure) message.failure = failure
  if (row.error) message.error = row.error
  if (row.ordinal !== null) message.ordinal = row.ordinal
  return message
}

export function toImageAttachment(
  row: MessageAttachmentMetadataRow
): ImageAttachment {
  return {
    type: row.type,
    id: row.id,
    name: row.name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
  }
}

function parsedPromptReferences(
  raw: string | null
): Pick<Message, "references"> | undefined {
  if (!raw) return undefined
  try {
    const result = promptReferenceSchema.array().safeParse(JSON.parse(raw))
    return result.success && result.data.length > 0
      ? { references: result.data }
      : undefined
  } catch {
    return undefined
  }
}

export function toActivity(row: ActivityRow): Activity {
  const activity: Activity = {
    id: row.id,
    threadId: row.thread_id,
    turnId: row.turn_id,
    name: row.name,
    status: row.status,
    createdAt: row.created_at,
  }
  if (row.detail) activity.detail = row.detail
  const payload = parsedPayload(row.payload)
  if (payload) activity.payload = payload.payload
  if (row.parent_id) activity.parentActivityId = row.parent_id
  if (row.ordinal !== null) activity.ordinal = row.ordinal
  if (row.finished_at) activity.finishedAt = row.finished_at
  return activity
}

/** A payload written by a newer build than this one reads as a plain row. */
function parsedPayload(
  raw: string | null
): Pick<Activity, "payload"> | undefined {
  if (!raw) return undefined
  try {
    const result = activityPayloadSchema.safeParse(JSON.parse(raw))
    return result.success ? { payload: result.data } : undefined
  } catch {
    return undefined
  }
}

export function toApproval(row: ApprovalRow): Approval {
  const approval: Approval = {
    id: row.id,
    threadId: row.thread_id,
    kind: row.kind,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
  }
  if (row.detail) approval.detail = row.detail
  return approval
}
