import { z } from "zod"

import { skillOccurrenceSchema } from "./skill-models.js"

export const jsonValueSchema = z.json()
export type JsonValue = z.infer<typeof jsonValueSchema>
export const jsonObjectSchema = z.record(z.string(), jsonValueSchema)
export type JsonObject = z.infer<typeof jsonObjectSchema>

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
  color: z.string(),
  icon: z.string(),
  sortOrder: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Workspace = z.infer<typeof workspaceSchema>

/** Every install has this workspace. It adopts orphaned projects and cannot be deleted. */
export const personalWorkspaceId = "personal"

export const projectSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  path: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Project = z.infer<typeof projectSchema>

export const packSkillSchema = z.object({
  id: z.string().min(1),
  packId: z.string().min(1),
  packName: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
})

export type PackSkill = z.infer<typeof packSkillSchema>

/**
 * A skill the composer can reference with `$name`. Packs reach every agent;
 * a skill found in an agent's own folder reaches only that agent, so the
 * composer filters on `harnessIds` before it offers one.
 */
export const promptSkillSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  origin: z.enum(["pack", "native"]),
  sourceLabel: z.string().min(1),
  harnessIds: z.array(z.string().min(1)).min(1),
})

export type PromptSkill = z.infer<typeof promptSkillSchema>

export const packKindSchema = z.enum(["managed", "linked"])
export type PackKind = z.infer<typeof packKindSchema>

export const packReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  installedAt: z.iso.datetime(),
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("created") }),
    z.object({ kind: z.literal("folder"), name: z.string().min(1) }),
    z.object({ kind: z.literal("zip"), name: z.string().min(1) }),
  ]),
  contentDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  fileCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
})

export type PackReceipt = z.infer<typeof packReceiptSchema>

export const mySkillsPackName = "My Skills"

/**
 * A Pack is a directory of skills the user manages in the app. Its layout is
 * provider-neutral (a manifest plus a skills/ directory of SKILL.md folders);
 * Harness Adapters translate it into their native mechanisms.
 */
export const packSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  kind: packKindSchema,
  contentDigest: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .nullable(),
  receipt: packReceiptSchema.nullable(),
  canEditSkills: z.boolean(),
  skills: z.array(packSkillSchema),
  occurrences: z.array(skillOccurrenceSchema),
  workspaceIds: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Pack = z.infer<typeof packSchema>

export const projectEntrySchema = z.object({
  path: z.string().min(1),
  kind: z.enum(["file", "directory"]),
})

export type ProjectEntry = z.infer<typeof projectEntrySchema>

/** A semantic resource selected in the composer and validated by the Runtime. */
export const promptReferenceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("project-entry"),
    path: z.string().min(1),
    entryKind: z.enum(["file", "directory"]),
  }),
  z.object({
    kind: z.literal("skill"),
    skillId: z.string().min(1),
    name: z.string().min(1),
  }),
])

export type PromptReference = z.infer<typeof promptReferenceSchema>

export const turnAttachmentLimit = 8
export const turnImageMaxBytes = 10 * 1024 * 1024
export const turnImageMimeTypes = [
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const
const turnImageDataUrlMaxCharacters =
  Math.ceil((turnImageMaxBytes * 4) / 3) + 128

export const imageAttachmentSchema = z.object({
  type: z.literal("image"),
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(255),
  mimeType: z.enum(turnImageMimeTypes),
  sizeBytes: z.number().int().positive().max(turnImageMaxBytes),
})

export type ImageAttachment = z.infer<typeof imageAttachmentSchema>

export const uploadImageAttachmentSchema = imageAttachmentSchema
  .extend({ dataUrl: z.string().max(turnImageDataUrlMaxCharacters) })
  .refine(
    (attachment) =>
      attachment.dataUrl.startsWith(`data:${attachment.mimeType};base64,`),
    { message: "Image data must match its media type", path: ["dataUrl"] }
  )

export type UploadImageAttachment = z.infer<typeof uploadImageAttachmentSchema>

export const imageAttachmentPreviewSchema = z.object({
  id: z.string().uuid(),
  dataUrl: z.string(),
})

export type ImageAttachmentPreview = z.infer<
  typeof imageAttachmentPreviewSchema
>

export const browserElementSelectionSchema = z.object({
  selector: z.string().min(1).max(1_024),
  tagName: z.string().min(1).max(64),
  role: z.string().max(64).nullable(),
  name: z.string().max(256).nullable(),
  text: z.string().max(280).nullable(),
})

export type BrowserElementSelection = z.infer<
  typeof browserElementSelectionSchema
>

export const browserElementContextSchema = browserElementSelectionSchema.extend(
  {
    id: z.string().uuid(),
    source: z.object({
      url: z.string().min(1).max(2_048),
      title: z.string().max(256),
    }),
    capturedAt: z.string().datetime(),
  }
)

export type BrowserElementContext = z.infer<typeof browserElementContextSchema>

export const turnInputSchema = z
  .object({
    text: z.string().trim(),
    references: z.array(promptReferenceSchema).default([]),
    attachments: z
      .array(uploadImageAttachmentSchema)
      .max(turnAttachmentLimit)
      .refine(
        (attachments) =>
          new Set(attachments.map((attachment) => attachment.id)).size ===
          attachments.length,
        { message: "Attachment IDs must be unique" }
      )
      .default([]),
    /** Page elements selected by the person in this Task's shared Browser. */
    browserContexts: z
      .array(browserElementContextSchema)
      .max(16)
      .refine(
        (contexts) =>
          new Set(contexts.map((context) => context.id)).size ===
          contexts.length,
        { message: "Browser context IDs must be unique" }
      )
      .optional(),
  })
  .refine(
    (input) =>
      input.text.length > 0 ||
      input.attachments.length > 0 ||
      (input.browserContexts?.length ?? 0) > 0,
    { message: "A message, image, or browser element is required" }
  )

export type TurnInput = z.infer<typeof turnInputSchema>

/** Where the user last was, so a restart reopens the same workspace and project. */
export const selectionSchema = z.object({
  lastWorkspaceId: z.string().nullable(),
  lastProjectIds: z.record(z.string(), z.string()),
})

export type Selection = z.infer<typeof selectionSchema>

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

export const executionProfilesByHarnessSchema = z.record(
  z.string().min(1),
  executionProfileSchema
)

export const preferencesSchema = z.object({
  lastProfile: lastProfileSchema.nullable(),
  profilesByHarness: executionProfilesByHarnessSchema,
})

export type Preferences = z.infer<typeof preferencesSchema>

/**
 * Effective settings after user overrides are applied to the defaults. Values
 * are opaque JSON at the protocol level; both sides read them through the
 * setting definitions in `@deskto/settings`.
 */
export const settingsSnapshotSchema = z.object({
  /** Every setting key mapped to the value currently in effect. */
  values: jsonObjectSchema,
  /** The subset the user has changed, keyed the same way. */
  overrides: jsonObjectSchema,
})

export type SettingsSnapshot = z.infer<typeof settingsSnapshotSchema>

export const threadStatusSchema = z.enum([
  "idle",
  "running",
  "waiting-approval",
  "failed",
])

/** Tokens currently occupying the harness context window. maxTokens is absent when the harness does not report a limit. */
export const contextUsageSchema = z.object({
  usedTokens: z.number().int().nonnegative(),
  maxTokens: z.number().int().positive().optional(),
})

export type ContextUsage = z.infer<typeof contextUsageSchema>

/**
 * The explicit close/keep-open decision on a task. "done" closes it, "active"
 * keeps it in the inbox and suppresses the automatic close rule. The Runtime
 * clears the override when a new turn begins, so it never hides new work.
 */
export const doneOverrideSchema = z.enum(["done", "active"])

export type DoneOverride = z.infer<typeof doneOverrideSchema>

/** Fixed orchestration guardrails shared by Runtime and MCP tools. */
export const maximumThreadChildren = 8
export const maximumThreadDepth = 2

export const threadSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  /** The Deskto task that created this background task. */
  parentThreadId: z.string().nullable(),
  title: z.string(),
  harnessId: z.string(),
  status: threadStatusSchema,
  executionProfile: executionProfileSchema,
  contextUsage: contextUsageSchema.optional(),
  /** When the latest turn was requested by the user. */
  lastUserMessageAt: z.string().nullable(),
  /** When the latest turn completed. Cancels and failures do not stamp it. */
  lastTurnCompletedAt: z.string().nullable(),
  /** When the thread entered its current failed status, or null while not
      failed. A clean edge on purpose: updatedAt also moves on profile and
      session writes, so it cannot tell a fresh failure from an old one. */
  failedAt: z.string().nullable(),
  /** When the user last opened this task; unread completions compare to it. */
  lastVisitedAt: z.string().nullable(),
  pinnedAt: z.string().nullable(),
  snoozedUntil: z.string().nullable(),
  /** When the snooze was set; wake rules compare event times to it. */
  snoozedAt: z.string().nullable(),
  doneOverride: doneOverrideSchema.nullable(),
  doneAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Thread = z.infer<typeof threadSchema>

export const threadSearchResultSchema = z.object({
  thread: threadSchema,
  projectName: z.string(),
  workspaceName: z.string(),
  excerpt: z.string(),
})

export type ThreadSearchResult = z.infer<typeof threadSearchResultSchema>

export const harnessFailureSchema = z.object({
  kind: z.enum(["usage-limit", "error"]),
  message: z.string(),
  resetAt: z.iso.datetime().optional(),
})

export type HarnessFailure = z.infer<typeof harnessFailureSchema>

export const messageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  turnId: z.string().optional(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  references: z.array(promptReferenceSchema).optional(),
  attachments: z.array(imageAttachmentSchema).optional(),
  state: z.enum(["streaming", "complete", "error"]),
  failure: harnessFailureSchema.optional(),
  /** Kept while existing databases migrate to the structured failure. */
  error: z.string().optional(),
  /** Position within the Turn, shared with activities so both interleave. */
  ordinal: z.number().int().optional(),
  createdAt: z.string(),
})

export type Message = z.infer<typeof messageSchema>

export const planStepSchema = z.object({
  text: z.string(),
  status: z.enum(["pending", "active", "done"]),
})

export type PlanStep = z.infer<typeof planStepSchema>

/**
 * Typed detail behind an Activity row. Kinds are provider-neutral; every
 * Harness Adapter classifies its native items into this vocabulary. An
 * Activity without a payload renders as the plain label row it always was.
 */
export const activityPayloadSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("tool"),
    tool: z.enum(["command", "search", "web", "mcp", "other"]),
  }),
  z.object({
    kind: z.literal("file-change"),
    files: z.array(
      z.object({
        path: z.string(),
        additions: z.number().int().nonnegative().optional(),
        deletions: z.number().int().nonnegative().optional(),
      })
    ),
  }),
  z.object({ kind: z.literal("plan"), steps: z.array(planStepSchema) }),
  z.object({
    kind: z.literal("subagent"),
    agentType: z.string().optional(),
  }),
])

export type ActivityPayload = z.infer<typeof activityPayloadSchema>

export const activitySchema = z.object({
  id: z.string(),
  threadId: z.string(),
  turnId: z.string(),
  name: z.string(),
  detail: z.string().optional(),
  status: z.enum(["running", "completed", "failed"]),
  payload: activityPayloadSchema.optional(),
  /** Owning Activity when this one ran inside a subagent. */
  parentActivityId: z.string().optional(),
  /** Position within the Turn, shared with messages so both interleave. */
  ordinal: z.number().int().optional(),
  createdAt: z.string(),
  finishedAt: z.string().optional(),
})

export type Activity = z.infer<typeof activitySchema>

export const artifactPreviewKindSchema = z.enum([
  "text",
  "markdown",
  "csv",
  "html",
  "image",
  "pdf",
  "spreadsheet",
  "document",
  "unsupported",
])

export type ArtifactPreviewKind = z.infer<typeof artifactPreviewKindSchema>

const pageLikeArtifactPreviewKinds = new Set<ArtifactPreviewKind>([
  "html",
  "pdf",
])

export function isPageLikeArtifactPreviewKind(
  kind: ArtifactPreviewKind
): kind is "html" | "pdf" {
  return pageLikeArtifactPreviewKinds.has(kind)
}

export const artifactSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  relativePath: z.string(),
  mediaType: z.string(),
  previewKind: artifactPreviewKindSchema,
  /** Whether this format may be handed to the operating system to open. */
  openable: z.boolean(),
  sizeBytes: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Artifact = z.infer<typeof artifactSchema>

/** A durable file attributed to the Turn that produced or changed it. */
export const turnOutputSchema = z.object({
  turnId: z.string(),
  producedAt: z.string(),
  artifact: artifactSchema,
})

export type TurnOutput = z.infer<typeof turnOutputSchema>

/** Preview data is fetched on demand and never included in ThreadView. */
export const artifactPreviewSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.enum(["text", "markdown", "csv", "html"]),
    artifactId: z.string(),
    content: z.string(),
  }),
  z.object({
    kind: z.literal("image"),
    artifactId: z.string(),
    dataUrl: z.string(),
  }),
  z.object({
    kind: z.literal("pdf"),
    artifactId: z.string(),
    dataBase64: z.string(),
  }),
  z.object({
    kind: z.enum(["spreadsheet", "document"]),
    artifactId: z.string(),
    dataBase64: z.string(),
  }),
  z.object({
    kind: z.literal("unsupported"),
    artifactId: z.string(),
  }),
])

export type ArtifactPreview = z.infer<typeof artifactPreviewSchema>

/**
 * Preview kinds the Surface may write back. Binary office formats stay out:
 * rewriting a workbook or a document from a simplified table would drop
 * formulas, styles, and every sheet the editor did not load.
 */
const editableArtifactPreviewKinds = new Set<ArtifactPreviewKind>([
  "text",
  "markdown",
  "csv",
])

export function isEditableArtifactPreviewKind(
  kind: ArtifactPreviewKind
): boolean {
  return editableArtifactPreviewKinds.has(kind)
}

export function isEditableArtifact(artifact: Artifact): boolean {
  return isEditableArtifactPreviewKind(artifact.previewKind)
}

/**
 * The on-disk location of an Artifact. Only the process hosting the Runtime
 * asks for this — a Surface acts on file actions by artifact id, so a renderer
 * never holds an absolute path it could hand to the shell.
 */
export const artifactLocationSchema = z.object({
  artifactId: z.string(),
  absolutePath: z.string(),
  /** File identity captured by the Runtime's containment check. */
  device: z.string(),
  inode: z.string(),
  /** False when the format is not safe to hand to the operating system. */
  openable: z.boolean(),
})

export type ArtifactLocation = z.infer<typeof artifactLocationSchema>

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
  childThreads: z.array(threadSchema),
  messages: z.array(messageSchema),
  activities: z.array(activitySchema),
  pendingApproval: approvalSchema.optional(),
  /**
   * Delta cursor for this thread. A `thread.delta` event applies to an open
   * view only when its seq is exactly view seq + 1; any gap means the view
   * must be reloaded. The counter lives in Runtime memory, so it restarts
   * with the process — reloads re-baseline it.
   */
  seq: z.number().int().nonnegative(),
})

export type ThreadView = z.infer<typeof threadViewSchema>
