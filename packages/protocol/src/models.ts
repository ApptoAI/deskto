import { z } from "zod"

export const harnessSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean(),
  availability: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("available"),
      version: z.string().optional(),
    }),
    z.object({ status: z.literal("unavailable"), reason: z.string() }),
  ]),
  /** When availability was last checked, or null before the first check. */
  checkedAt: z.string().nullable(),
  models: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      description: z.string().optional(),
      supportedEfforts: z.array(z.string().min(1)),
      defaultEffort: z.string().min(1).optional(),
      isDefault: z.boolean(),
      supportedPermissionModes: z.array(
        z.enum(["approval-required", "auto", "full-access"])
      ),
    })
  ),
})

export type Harness = z.infer<typeof harnessSchema>

export const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Workspace = z.infer<typeof workspaceSchema>

export const executionProfileSchema = z.object({
  modelId: z.string().min(1).nullable(),
  effort: z.string().min(1).nullable(),
  permissionMode: z.enum(["approval-required", "auto", "full-access"]),
})

export type ExecutionProfile = z.infer<typeof executionProfileSchema>

/** The harness and profile most recently used to create or configure a thread. */
export const lastProfileSchema = z.object({
  harnessId: z.string().min(1),
  executionProfile: executionProfileSchema,
})

export type LastProfile = z.infer<typeof lastProfileSchema>

export const preferencesSchema = z.object({
  lastProfile: lastProfileSchema.nullable(),
})

export type Preferences = z.infer<typeof preferencesSchema>

/**
 * Effective settings after user overrides are applied to the defaults. Values
 * are opaque JSON at the protocol level; both sides read them through the
 * setting definitions in `@openappto/settings`.
 */
export const settingsSnapshotSchema = z.object({
  /** Every setting key mapped to the value currently in effect. */
  values: z.record(z.string(), z.unknown()),
  /** The subset the user has changed, keyed the same way. */
  overrides: z.record(z.string(), z.unknown()),
})

export type SettingsSnapshot = z.infer<typeof settingsSnapshotSchema>

export const threadStatusSchema = z.enum([
  "idle",
  "running",
  "waiting-approval",
  "failed",
])

export const threadSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  title: z.string(),
  harnessId: z.string(),
  status: threadStatusSchema,
  executionProfile: executionProfileSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Thread = z.infer<typeof threadSchema>

export const messageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  turnId: z.string().optional(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  state: z.enum(["streaming", "complete", "error"]),
  error: z.string().optional(),
  createdAt: z.string(),
})

export type Message = z.infer<typeof messageSchema>

export const activitySchema = z.object({
  id: z.string(),
  threadId: z.string(),
  turnId: z.string(),
  name: z.string(),
  detail: z.string().optional(),
  status: z.enum(["running", "completed", "failed"]),
  createdAt: z.string(),
  finishedAt: z.string().optional(),
})

export type Activity = z.infer<typeof activitySchema>

export const approvalSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  kind: z.enum(["command", "file-change", "tool"]),
  title: z.string(),
  detail: z.string().optional(),
  status: z.enum(["pending", "approved", "denied"]),
  createdAt: z.string(),
})

export type Approval = z.infer<typeof approvalSchema>

export const threadViewSchema = z.object({
  thread: threadSchema,
  messages: z.array(messageSchema),
  activities: z.array(activitySchema),
  pendingApproval: approvalSchema.optional(),
})

export type ThreadView = z.infer<typeof threadViewSchema>
