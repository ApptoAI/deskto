import type {
  Activity,
  Approval,
  Message,
  Thread,
  Project,
  Workspace,
} from "@openappto/protocol"

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
  created_at: string
  updated_at: string
}

export type MessageRow = {
  id: string
  thread_id: string
  turn_id: string | null
  role: Message["role"]
  content: string
  state: Message["state"]
  error: string | null
  created_at: string
}

export type ActivityRow = {
  id: string
  thread_id: string
  turn_id: string
  name: string
  detail: string | null
  status: Activity["status"]
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
  created_at: string
  updated_at: string
}

/** The database half of a Pack; skills and attachments are composed on top. */
export function toPackRecord(row: PackRow) {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
  const contextUsage =
    row.context_used_tokens !== null
      ? {
          usedTokens: row.context_used_tokens,
          ...(row.context_max_tokens !== null
            ? { maxTokens: row.context_max_tokens }
            : {}),
        }
      : undefined
  return {
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
    ...(contextUsage ? { contextUsage } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    threadId: row.thread_id,
    ...(row.turn_id ? { turnId: row.turn_id } : {}),
    role: row.role,
    content: row.content,
    state: row.state,
    ...(row.error ? { error: row.error } : {}),
    createdAt: row.created_at,
  }
}

export function toActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    threadId: row.thread_id,
    turnId: row.turn_id,
    name: row.name,
    status: row.status,
    createdAt: row.created_at,
    ...(row.detail ? { detail: row.detail } : {}),
    ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
  }
}

export function toApproval(row: ApprovalRow): Approval {
  return {
    id: row.id,
    threadId: row.thread_id,
    kind: row.kind,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    ...(row.detail ? { detail: row.detail } : {}),
  }
}
