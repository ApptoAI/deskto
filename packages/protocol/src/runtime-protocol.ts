import { z } from "zod"

import {
  harnessSchema,
  executionProfileSchema,
  preferencesSchema,
  settingsSnapshotSchema,
  threadSchema,
  threadViewSchema,
  workspaceSchema,
} from "./models.js"

export const runtimeRequestSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("harness.list"), params: z.object({}) }),
  z.object({
    method: z.literal("harness.setEnabled"),
    params: z.object({ harnessId: z.string().min(1), enabled: z.boolean() }),
  }),
  z.object({ method: z.literal("harness.refresh"), params: z.object({}) }),
  z.object({ method: z.literal("preferences.get"), params: z.object({}) }),
  z.object({ method: z.literal("settings.get"), params: z.object({}) }),
  z.object({
    method: z.literal("settings.update"),
    // A null entry clears that override back to its default value.
    params: z.object({ entries: z.record(z.string(), z.unknown()) }),
  }),
  z.object({ method: z.literal("workspace.list"), params: z.object({}) }),
  z.object({
    method: z.literal("workspace.add"),
    params: z.object({ path: z.string().min(1), name: z.string().min(1) }),
  }),
  z.object({
    method: z.literal("thread.list"),
    params: z.object({ workspaceId: z.string() }),
  }),
  z.object({
    method: z.literal("thread.create"),
    params: z.object({
      workspaceId: z.string(),
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
    method: z.literal("turn.start"),
    params: z.object({
      threadId: z.string(),
      prompt: z.string().trim().min(1),
    }),
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
  "workspace.add": z.infer<typeof workspaceSchema>
  "thread.list": z.infer<typeof threadSchema>[]
  "thread.create": z.infer<typeof threadSchema>
  "thread.configure": z.infer<typeof threadViewSchema>
  "thread.get": z.infer<typeof threadViewSchema>
  "turn.start": z.infer<typeof threadViewSchema>
  "turn.cancel": z.infer<typeof threadViewSchema>
  "approval.resolve": z.infer<typeof threadViewSchema>
}

export type RuntimeResponse<M extends RuntimeMethod = RuntimeMethod> =
  | { ok: true; data: RuntimeResponses[M] }
  | { ok: false; error: { code: string; message: string } }

export const runtimeEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("thread.changed"), threadId: z.string() }),
  z.object({ type: z.literal("harness.changed") }),
  z.object({ type: z.literal("settings.changed") }),
])

export type RuntimeEvent = z.infer<typeof runtimeEventSchema>

export interface RuntimeTransport {
  request<M extends RuntimeMethod>(
    request: RequestFor<M>
  ): Promise<RuntimeResponse<M>>
  subscribe(listener: (event: RuntimeEvent) => void): () => void
}
