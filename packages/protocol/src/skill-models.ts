import { z } from "zod"

export const skillDiagnosticCodeSchema = z.enum([
  "source-not-directory",
  "source-unreadable",
  "skill-file-missing",
  "skill-file-unreadable",
  "skill-file-too-large",
  "skill-path-outside-source",
  "skill-content-unreadable",
  "frontmatter-missing",
  "frontmatter-invalid",
  "name-missing",
  "description-missing",
])

export type SkillDiagnosticCode = z.infer<typeof skillDiagnosticCodeSchema>

export const skillDiagnosticSchema = z.object({
  code: skillDiagnosticCodeSchema,
  severity: z.enum(["warning", "error"]),
  message: z.string().min(1),
  path: z.string().min(1),
})

export type SkillDiagnostic = z.infer<typeof skillDiagnosticSchema>

export const skillProvisioningReportSchema = z.object({
  turnId: z.string().min(1),
  rootId: z.string().min(1),
  harnessId: z.string().min(1),
  rootPath: z.string().min(1),
  contentDigest: z.string().nullable(),
  status: z.enum(["configured", "unsupported", "failed"]),
  method: z.string().min(1),
  message: z.string().min(1).optional(),
  attemptedAt: z.iso.datetime(),
})

export type SkillProvisioningReport = z.infer<
  typeof skillProvisioningReportSchema
>

export const skillSourceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["native", "pack"]),
  scopes: z.array(z.enum(["project", "user", "admin", "workspace"])).min(1),
  label: z.string().min(1),
  path: z.string().min(1),
  harnessIds: z.array(z.string().min(1)),
  packId: z.string().min(1).optional(),
  packKind: z.enum(["managed", "linked"]).optional(),
  editable: z.boolean(),
  provisioning: z.array(skillProvisioningReportSchema),
  diagnostics: z.array(skillDiagnosticSchema),
})

export type SkillSource = z.infer<typeof skillSourceSchema>

export const skillOccurrenceSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  directoryName: z.string().min(1),
  directoryPath: z.string().min(1),
  resolvedDirectoryPath: z.string().min(1),
  skillFilePath: z.string().min(1),
  name: z.string().min(1).nullable(),
  description: z.string().min(1).nullable(),
  instructionDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  contentDigest: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .nullable(),
  hasScripts: z.boolean(),
  hasReferences: z.boolean(),
  hasAssets: z.boolean(),
  diagnostics: z.array(skillDiagnosticSchema),
})

export type SkillOccurrence = z.infer<typeof skillOccurrenceSchema>

export const skillInventorySchema = z.object({
  projectId: z.string().min(1).nullable(),
  scannedAt: z.iso.datetime(),
  sources: z.array(skillSourceSchema),
  occurrences: z.array(skillOccurrenceSchema),
})

export type SkillInventory = z.infer<typeof skillInventorySchema>

export const managedSkillDraftSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  instructions: z.string().trim().min(1),
})

export type ManagedSkillDraft = z.infer<typeof managedSkillDraftSchema>

export const skillDetailsSchema = z.object({
  occurrence: skillOccurrenceSchema,
  content: z.string().nullable(),
})

export type SkillDetails = z.infer<typeof skillDetailsSchema>

export type SkillLookupContext =
  | { projectId: string; workspaceId?: never }
  | { workspaceId: string; projectId?: never }
