import { createHash } from "node:crypto"
import { readFile, stat } from "node:fs/promises"

import type { SkillDiagnostic } from "@deskto/protocol"
import { parseDocument } from "yaml"
import { z } from "zod"

export const maxSkillFileBytes = 1024 * 1024

const missingFileSchema = z.object({ code: z.literal("ENOENT") })
const errorMessageSchema = z
  .instanceof(Error)
  .transform((error) => error.message)
  .catch("Frontmatter could not be read")
const skillMetadataSchema = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
  })
  .passthrough()
type SkillMetadata = z.infer<typeof skillMetadataSchema>

export type ParsedSkillFile = {
  name: string | null
  description: string | null
  instructionDigest: string | null
  content: string | null
  diagnostics: SkillDiagnostic[]
}

export async function parseSkillFile(path: string): Promise<ParsedSkillFile> {
  let metadata
  try {
    metadata = await stat(path)
  } catch (error) {
    return unreadableResult(path, missingFileSchema.safeParse(error).success)
  }
  if (!metadata.isFile()) {
    return resultWithDiagnostic({
      code: "skill-file-unreadable",
      severity: "error",
      message: "SKILL.md is not a regular file",
      path,
    })
  }
  if (metadata.size > maxSkillFileBytes) {
    return resultWithDiagnostic({
      code: "skill-file-too-large",
      severity: "error",
      message: "SKILL.md is larger than 1 MiB",
      path,
    })
  }

  let bytes: Buffer
  try {
    bytes = await readFile(path)
  } catch (error) {
    return unreadableResult(path, missingFileSchema.safeParse(error).success)
  }
  const content = bytes.toString("utf8").replace(/^\uFEFF/, "")
  const instructionDigest = createHash("sha256").update(bytes).digest("hex")
  const frontmatter = frontmatterFrom(content)
  if (frontmatter === null) {
    return {
      ...emptyMetadata(),
      content,
      instructionDigest,
      diagnostics: [
        {
          code: "frontmatter-missing",
          severity: "error",
          message: "SKILL.md needs YAML frontmatter between --- markers",
          path,
        },
      ],
    }
  }

  const document = parseDocument(frontmatter, { prettyErrors: false })
  if (document.errors.length > 0) {
    return {
      ...emptyMetadata(),
      content,
      instructionDigest,
      diagnostics: [
        {
          code: "frontmatter-invalid",
          severity: "error",
          message: document.errors[0]?.message ?? "Frontmatter is invalid YAML",
          path,
        },
      ],
    }
  }

  let value: unknown
  try {
    value = document.toJS({ maxAliasCount: 100 })
  } catch (error) {
    return {
      ...emptyMetadata(),
      content,
      instructionDigest,
      diagnostics: [
        {
          code: "frontmatter-invalid",
          severity: "error",
          message: errorMessageSchema.parse(error),
          path,
        },
      ],
    }
  }
  const metadataResult = skillMetadataSchema.safeParse(value)
  if (!metadataResult.success) {
    return {
      ...emptyMetadata(),
      content,
      instructionDigest,
      diagnostics: [
        {
          code: "frontmatter-invalid",
          severity: "error",
          message:
            metadataResult.error.issues[0]?.message ??
            "Frontmatter must be a YAML object with string metadata",
          path,
        },
      ],
    }
  }

  const diagnostics: SkillDiagnostic[] = []
  const name = metadataString(metadataResult.data, "name", path, diagnostics)
  const description = metadataString(
    metadataResult.data,
    "description",
    path,
    diagnostics
  )
  return { name, description, instructionDigest, content, diagnostics }
}

function frontmatterFrom(content: string): string | null {
  const lines = content.split(/\r?\n/)
  if (lines[0] !== "---") return null
  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && (line === "---" || line === "...")
  )
  if (closingIndex < 0) return null
  return lines.slice(1, closingIndex).join("\n")
}

function metadataString(
  value: SkillMetadata,
  key: "name" | "description",
  path: string,
  diagnostics: SkillDiagnostic[]
): string | null {
  const raw = key === "name" ? value.name : value.description
  if (raw?.trim()) return raw.trim()
  diagnostics.push({
    code: key === "name" ? "name-missing" : "description-missing",
    severity: "error",
    message: `Frontmatter needs a non-empty ${key}`,
    path,
  })
  return null
}

function unreadableResult(path: string, missing: boolean): ParsedSkillFile {
  return resultWithDiagnostic({
    code: missing ? "skill-file-missing" : "skill-file-unreadable",
    severity: "error",
    message: missing
      ? "Skill folder has no SKILL.md"
      : "SKILL.md could not be read",
    path,
  })
}

function resultWithDiagnostic(diagnostic: SkillDiagnostic): ParsedSkillFile {
  return {
    ...emptyMetadata(),
    instructionDigest: null,
    content: null,
    diagnostics: [diagnostic],
  }
}

function emptyMetadata() {
  return { name: null, description: null } as const
}
