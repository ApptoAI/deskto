import { createHash } from "node:crypto"
import { realpath } from "node:fs/promises"

import type { SkillDiagnostic } from "@deskto/protocol"
import { parseDocument } from "yaml"
import { z } from "zod"

import { openRegularFileWithinRoot } from "../safe-file-open.js"

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

export async function parseSkillFile(
  path: string,
  root: string
): Promise<ParsedSkillFile> {
  let opened
  try {
    opened = await openRegularFileWithinRoot(path, await realpath(root))
  } catch (error) {
    return unreadableResult(path, missingFileSchema.safeParse(error).success)
  }

  let bytes: Buffer
  try {
    if (opened.metadata.size > maxSkillFileBytes) {
      return tooLargeResult(path)
    }
    // Sized from the file, not from the ceiling: a scan opens one of these
    // per skill folder and a fleet of them would otherwise reserve a megabyte
    // each. One byte over the reported size still catches a file that grew
    // past the limit between the stat and the read.
    let buffer = Buffer.allocUnsafe(
      Math.min(opened.metadata.size, maxSkillFileBytes) + 1
    )
    let length = 0
    for (;;) {
      const { bytesRead } = await opened.handle.read(
        buffer,
        length,
        buffer.length - length,
        length
      )
      if (bytesRead === 0) break
      length += bytesRead
      if (length > maxSkillFileBytes) return tooLargeResult(path)
      if (length === buffer.length) {
        const grown = Buffer.allocUnsafe(
          Math.min(maxSkillFileBytes + 1, Math.max(buffer.length * 2, 2))
        )
        buffer.copy(grown)
        buffer = grown
      }
    }
    bytes = buffer.subarray(0, length)
  } catch (error) {
    return unreadableResult(path, missingFileSchema.safeParse(error).success)
  } finally {
    await opened.handle.close().catch(() => undefined)
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

function tooLargeResult(path: string): ParsedSkillFile {
  return resultWithDiagnostic({
    code: "skill-file-too-large",
    severity: "error",
    message: "SKILL.md is larger than 1 MiB",
    path,
  })
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
