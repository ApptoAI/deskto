import { z } from "zod"

import {
  activitySchema,
  approvalSchema,
  harnessSchema,
  executionProfileSchema,
  messageSchema,
  packSchema,
  packSkillSchema,
  preferencesSchema,
  projectEntrySchema,
  selectionSchema,
  settingsSnapshotSchema,
  threadSchema,
  threadViewSchema,
  turnInputSchema,
  projectSchema,
  workspaceSchema,
} from "./models.js"

export const runtimeRequestSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("harness.list"), params: z.object({}) }),
  z.object({
    method: z.literal("harness.setEnabled"),
    params: z.object({ harnessId: z.string().min(1), enabled: z.boolean() }),
  }),
  z.object({ method: z.literal("harness.refresh"), params: z.object({}) }),
  z.object({
    method: z.literal("preferences.get"),
    params: z.object({ workspaceId: z.string().min(1) }),
  }),
  z.object({ method: z.literal("settings.get"), params: z.object({}) }),
  z.object({
    method: z.literal("settings.update"),
    // A null entry clears that override back to its default value.
    params: z.object({ entries: z.record(z.string(), z.unknown()) }),
  }),
  z.object({ method: z.literal("workspace.list"), params: z.object({}) }),
  z.object({
    method: z.literal("workspace.create"),
    params: z.object({
      name: z.string().min(1),
      color: z.string().min(1),
      icon: z.string().min(1),
    }),
  }),
  z.object({
    method: z.literal("workspace.update"),
    params: z.object({
      workspaceId: z.string().min(1),
      name: z.string().min(1).optional(),
      color: z.string().min(1).optional(),
      icon: z.string().min(1).optional(),
    }),
  }),
  z.object({
    method: z.literal("workspace.delete"),
    params: z.object({ workspaceId: z.string().min(1) }),
  }),
  z.object({ method: z.literal("selection.get"), params: z.object({}) }),
  z.object({
    method: z.literal("selection.set"),
    params: z.object({
      workspaceId: z.string().min(1),
      projectId: z.string().min(1).optional(),
    }),
  }),
  z.object({ method: z.literal("pack.list"), params: z.object({}) }),
  z.object({
    method: z.literal("pack.create"),
    params: z.object({ name: z.string().min(1) }),
  }),
  z.object({
    method: z.literal("pack.import"),
    params: z.object({ path: z.string().min(1) }),
  }),
  z.object({
    method: z.literal("pack.remove"),
    params: z.object({ packId: z.string().min(1) }),
  }),
  z.object({
    method: z.literal("workspace.setPack"),
    params: z.object({
      workspaceId: z.string().min(1),
      packId: z.string().min(1),
      attached: z.boolean(),
    }),
  }),
  z.object({
    method: z.literal("workspace.listSkills"),
    params: z.object({ workspaceId: z.string().min(1) }),
  }),
  z.object({ method: z.literal("project.list"), params: z.object({}) }),
  z.object({
    method: z.literal("project.add"),
    params: z.object({
      path: z.string().min(1),
      name: z.string().min(1),
      workspaceId: z.string().min(1),
    }),
  }),
  z.object({
    method: z.literal("project.move"),
    params: z.object({
      projectId: z.string().min(1),
      workspaceId: z.string().min(1),
    }),
  }),
  z.object({
    method: z.literal("project.searchEntries"),
    params: z.object({
      projectId: z.string().min(1),
      query: z.string().max(200),
      limit: z.number().int().min(1).max(80).default(50),
    }),
  }),
  z.object({
    method: z.literal("thread.list"),
    params: z.object({ projectId: z.string() }),
  }),
  z.object({
    method: z.literal("thread.create"),
    params: z.object({
      projectId: z.string(),
      harnessId: z.string(),
      executionProfile: executionProfileSchema.optional(),
    }),
  }),
  z.object({
    method: z.literal("thread.configure"),
    params: z.object({
      threadId: z.string(),
      executionProfile: executionProfileSchema,
    }),
  }),
  z.object({
    method: z.literal("thread.get"),
    params: z.object({ threadId: z.string() }),
  }),
  z.object({
    method: z.literal("thread.setDone"),
    params: z.object({ threadId: z.string(), done: z.boolean() }),
  }),
  z.object({
    method: z.literal("thread.snooze"),
    params: z.object({ threadId: z.string(), until: z.iso.datetime() }),
  }),
  z.object({
    method: z.literal("thread.wake"),
    params: z.object({ threadId: z.string() }),
  }),
  z.object({
    method: z.literal("thread.setPinned"),
    params: z.object({ threadId: z.string(), pinned: z.boolean() }),
  }),
  z.object({
    method: z.literal("thread.markVisited"),
    params: z.object({ threadId: z.string() }),
  }),
  z.object({
    method: z.literal("turn.start"),
    params: z
      .object({
        threadId: z.string(),
        input: turnInputSchema.optional(),
        /** Compatibility for callers predating semantic prompt references. */
        prompt: z.string().trim().min(1).optional(),
      })
      .refine(
        (params) => params.input !== undefined || params.prompt !== undefined,
        {
          message: "A turn input is required",
        }
      ),
  }),
  z.object({
    method: z.literal("turn.cancel"),
    params: z.object({ threadId: z.string() }),
  }),
  z.object({
    method: z.literal("approval.resolve"),
    params: z.object({
      threadId: z.string(),
      approvalId: z.string(),
      decision: z.enum(["approve", "deny"]),
    }),
  }),
])

export type RuntimeRequest = z.infer<typeof runtimeRequestSchema>
export type RuntimeMethod = RuntimeRequest["method"]
export type RequestFor<M extends RuntimeMethod> = Extract<
  RuntimeRequest,
  { method: M }
>

export interface RuntimeResponses {
  "harness.list": z.infer<typeof harnessSchema>[]
  "harness.setEnabled": z.infer<typeof harnessSchema>[]
  "harness.refresh": z.infer<typeof harnessSchema>[]
  "preferences.get": z.infer<typeof preferencesSchema>
  "settings.get": z.infer<typeof settingsSnapshotSchema>
  "settings.update": z.infer<typeof settingsSnapshotSchema>
  "workspace.list": z.infer<typeof workspaceSchema>[]
  "workspace.create": z.infer<typeof workspaceSchema>
  "workspace.update": z.infer<typeof workspaceSchema>
  "workspace.delete": null
  "selection.get": z.infer<typeof selectionSchema>
  "selection.set": z.infer<typeof selectionSchema>
  "pack.list": z.infer<typeof packSchema>[]
  "pack.create": z.infer<typeof packSchema>
  "pack.import": z.infer<typeof packSchema>
  "pack.remove": null
  "workspace.setPack": null
  "workspace.listSkills": z.infer<typeof packSkillSchema>[]
  "project.list": z.infer<typeof projectSchema>[]
  "project.add": z.infer<typeof projectSchema>
  "project.move": z.infer<typeof projectSchema>
  "project.searchEntries": z.infer<typeof projectEntrySchema>[]
  "thread.list": z.infer<typeof threadSchema>[]
  "thread.create": z.infer<typeof threadSchema>
  "thread.configure": z.infer<typeof threadViewSchema>
  "thread.get": z.infer<typeof threadViewSchema>
  "thread.setDone": z.infer<typeof threadSchema>
  "thread.snooze": z.infer<typeof threadSchema>
  "thread.wake": z.infer<typeof threadSchema>
  "thread.setPinned": z.infer<typeof threadSchema>
  "thread.markVisited": z.infer<typeof threadSchema>
  "turn.start": z.infer<typeof threadViewSchema>
  "turn.cancel": z.infer<typeof threadViewSchema>
  "approval.resolve": z.infer<typeof threadViewSchema>
}

export type RuntimeResponse<M extends RuntimeMethod = RuntimeMethod> =
  | { ok: true; data: RuntimeResponses[M] }
  | { ok: false; error: { code: string; message: string } }

/**
 * One incremental change to an open Thread view. Deltas cover everything that
 * changes while a Turn runs (text chunks, activity rows, approvals, usage);
 * turn start and completion still go through `thread.changed` and a full
 * reload.
 */
export const threadDeltaChangeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("message.appended"),
    messageId: z.string(),
    text: z.string(),
  }),
  z.object({ type: z.literal("message.upserted"), message: messageSchema }),
  z.object({ type: z.literal("activity.upserted"), activity: activitySchema }),
  z.object({ type: z.literal("approval.requested"), approval: approvalSchema }),
  z.object({
    type: z.literal("approval.resolved"),
    approvalId: z.string(),
  }),
  z.object({ type: z.literal("thread.updated"), thread: threadSchema }),
])

export type ThreadDeltaChange = z.infer<typeof threadDeltaChangeSchema>

export const runtimeEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("thread.changed"), threadId: z.string() }),
  z.object({
    type: z.literal("thread.delta"),
    threadId: z.string(),
    /** Matches ThreadView.seq: apply when seq is view seq + 1, else reload. */
    seq: z.number().int().positive(),
    change: threadDeltaChangeSchema,
  }),
  z.object({ type: z.literal("harness.changed") }),
  z.object({ type: z.literal("settings.changed") }),
  z.object({ type: z.literal("workspace.changed") }),
  z.object({ type: z.literal("pack.changed") }),
])

export type RuntimeEvent = z.infer<typeof runtimeEventSchema>

export interface RuntimeTransport {
  request<M extends RuntimeMethod>(
    request: RequestFor<M>
  ): Promise<RuntimeResponse<M>>
  subscribe(listener: (event: RuntimeEvent) => void): () => void
}
