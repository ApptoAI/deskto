import { readdir, realpath, stat } from "node:fs/promises"
import { join } from "node:path"

import type {
  SkillDiagnostic,
  SkillOccurrence,
  SkillSource,
} from "@deskto/protocol"
import { z } from "zod"

import { digestPackDirectory } from "../packs/pack-digest.js"
import { pathIsWithin } from "../path-boundaries.js"
import { skillOccurrenceId } from "./skill-identifiers.js"
import { parseSkillFile } from "./skill-parser.js"

const missingFileSystemEntrySchema = z.object({ code: z.literal("ENOENT") })

export type SkillSourceInput = Omit<SkillSource, "diagnostics">

export type ScannedSkill = {
  occurrence: SkillOccurrence
  content: string | null
}

export type ScannedSkillSource = {
  source: SkillSource | null
  skills: ScannedSkill[]
}

export async function scanSkillSource(
  source: SkillSourceInput,
  options: { missingIsDiagnostic: boolean }
): Promise<ScannedSkillSource> {
  const sourceIssue = await inspectSource(source.path)
  if (sourceIssue) {
    if (sourceIssue.missing && !options.missingIsDiagnostic) {
      return { source: null, skills: [] }
    }
    return {
      source: { ...source, diagnostics: [sourceIssue.diagnostic] },
      skills: [],
    }
  }

  const resolvedSourcePath = await realpath(source.path).catch(() => null)
  if (!resolvedSourcePath) {
    return {
      source: {
        ...source,
        diagnostics: [
          {
            code: "source-unreadable",
            severity: "error",
            message: "Skill source could not be resolved",
            path: source.path,
          },
        ],
      },
      skills: [],
    }
  }

  let entries
  try {
    entries = await readdir(source.path, { withFileTypes: true })
  } catch {
    const diagnostic: SkillDiagnostic = {
      code: "source-unreadable",
      severity: "error",
      message: "Skill source could not be read",
      path: source.path,
    }
    return {
      source: { ...source, diagnostics: [diagnostic] },
      skills: [],
    }
  }

  const candidates = entries.filter(
    (entry) => entry.isDirectory() || entry.isSymbolicLink()
  )
  const skills = await Promise.all(
    candidates.map((entry) =>
      scanSkillDirectory(
        source,
        resolvedSourcePath,
        entry.name,
        entry.isSymbolicLink()
      )
    )
  )
  return {
    source: { ...source, diagnostics: [] },
    skills: skills
      .filter((skill): skill is ScannedSkill => skill !== null)
      .sort(compareScannedSkills),
  }
}

async function scanSkillDirectory(
  source: SkillSourceInput,
  resolvedSourcePath: string,
  directoryName: string,
  isSymbolicLink: boolean
): Promise<ScannedSkill | null> {
  const directoryPath = join(source.path, directoryName)
  const directory = await directoryTarget(directoryPath, isSymbolicLink)
  if (!directory) return null
  const skillFilePath = join(directoryPath, "SKILL.md")
  if (!pathIsWithin(resolvedSourcePath, directory)) {
    return {
      occurrence: {
        id: skillOccurrenceId(source.id, directoryName),
        sourceId: source.id,
        directoryName,
        directoryPath,
        resolvedDirectoryPath: directory,
        skillFilePath,
        name: null,
        description: null,
        instructionDigest: null,
        contentDigest: null,
        hasScripts: false,
        hasReferences: false,
        hasAssets: false,
        diagnostics: [
          {
            code: "skill-path-outside-source",
            severity: "error",
            message: "Skill folder resolves outside its declared source",
            path: directoryPath,
          },
        ],
      },
      content: null,
    }
  }
  const parsed = await parseSkillFile(skillFilePath)
  const [hasScripts, hasReferences, hasAssets, contentDigest] =
    await Promise.all([
      isDirectory(join(directoryPath, "scripts")),
      isDirectory(join(directoryPath, "references")),
      isDirectory(join(directoryPath, "assets")),
      digestSkillDirectory(directoryPath),
    ])
  return {
    occurrence: {
      id: skillOccurrenceId(source.id, directoryName),
      sourceId: source.id,
      directoryName,
      directoryPath,
      resolvedDirectoryPath: directory,
      skillFilePath,
      name: parsed.name,
      description: parsed.description,
      instructionDigest: parsed.instructionDigest,
      contentDigest: contentDigest.value,
      hasScripts,
      hasReferences,
      hasAssets,
      diagnostics: contentDigest.diagnostic
        ? [...parsed.diagnostics, contentDigest.diagnostic]
        : parsed.diagnostics,
    },
    content: parsed.content,
  }
}

async function digestSkillDirectory(path: string): Promise<{
  value: string | null
  diagnostic?: SkillDiagnostic
}> {
  try {
    return { value: (await digestPackDirectory(path)).contentDigest }
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : ""
    return {
      value: null,
      diagnostic: {
        code: "skill-content-unreadable",
        severity: "error",
        message: `Skill contents could not be hashed${detail}`,
        path,
      },
    }
  }
}

async function inspectSource(
  path: string
): Promise<{ diagnostic: SkillDiagnostic; missing: boolean } | null> {
  try {
    if ((await stat(path)).isDirectory()) return null
    return {
      diagnostic: {
        code: "source-not-directory",
        severity: "error",
        message: "Skill source is not a directory",
        path,
      },
      missing: false,
    }
  } catch (error) {
    const missing = missingFileSystemEntrySchema.safeParse(error).success
    return {
      diagnostic: {
        code: missing ? "source-not-directory" : "source-unreadable",
        severity: "error",
        message: missing
          ? "Skill source does not exist"
          : "Skill source could not be inspected",
        path,
      },
      missing,
    }
  }
}

async function directoryTarget(
  path: string,
  keepBrokenSymbolicLink: boolean
): Promise<string | null> {
  try {
    if (!(await stat(path)).isDirectory()) return null
    return await realpath(path)
  } catch {
    return keepBrokenSymbolicLink ? path : null
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

function compareScannedSkills(left: ScannedSkill, right: ScannedSkill): number {
  const leftName = left.occurrence.name ?? left.occurrence.directoryName
  const rightName = right.occurrence.name ?? right.occurrence.directoryName
  return (
    leftName.localeCompare(rightName) ||
    left.occurrence.directoryName.localeCompare(right.occurrence.directoryName)
  )
}
