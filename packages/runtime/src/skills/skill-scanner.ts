import { lstat, readdir, realpath, stat } from "node:fs/promises"
import { availableParallelism } from "node:os"
import { join } from "node:path"

import type {
  SkillDiagnostic,
  SkillOccurrence,
  SkillSource,
} from "@deskto/protocol"
import { z } from "zod"

import { digestPackDirectory } from "../packs/pack-digest.js"
import { pathIsWithin } from "../path-boundaries.js"
import {
  isSkillRecoveryFileName,
  skillOccurrenceId,
} from "./skill-identifiers.js"
import { parseSkillFile } from "./skill-parser.js"

const missingFileSystemEntrySchema = z.object({ code: z.literal("ENOENT") })
const skillNameScanWorkers = Math.max(1, availableParallelism())

export type SkillSourceInput = Omit<SkillSource, "diagnostics">

export type ScannedSkill = {
  occurrence: SkillOccurrence
  content: string | null
}

export type ScannedSkillSource = {
  source: SkillSource | null
  skills: ScannedSkill[]
}

/** What a name-only scan knows about one skill folder. */
export type ScannedSkillName = {
  id: string
  directoryName: string
  skillFilePath: string
  name: string
  description: string
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

/**
 * Names and descriptions only, for the composer's `$` menu. A full scan hashes
 * every skill folder and probes for scripts, references and assets — four
 * extra filesystem round trips per skill plus a recursive digest. That is the
 * right price for the Skills screen and the wrong one for a keystroke, so this
 * reads one SKILL.md per folder and stops.
 */
export async function scanSkillNames(source: {
  id: string
  path: string
}): Promise<ScannedSkillName[]> {
  const resolvedSourcePath = await realpath(source.path).catch(() => null)
  if (!resolvedSourcePath) return []
  const sourcePath = resolvedSourcePath
  let entries
  try {
    entries = await readdir(source.path, { withFileTypes: true })
  } catch {
    return []
  }

  const candidates = entries.filter(
    (entry) => entry.isDirectory() || entry.isSymbolicLink()
  )
  const scanned: Array<ScannedSkillName | null> = Array.from(
    { length: candidates.length },
    () => null
  )
  let nextIndex = 0
  async function scanNext(): Promise<void> {
    for (;;) {
      const index = nextIndex
      nextIndex += 1
      const entry = candidates[index]
      if (!entry) return
      const directoryPath = join(source.path, entry.name)
      const directory = await skillDirectoryTarget(
        sourcePath,
        directoryPath,
        entry.isSymbolicLink() ? join(sourcePath, entry.name) : null
      )
      // A folder that leaves its source is a skill the Skills screen reports
      // and nothing offers; there is nothing to say about it in a menu.
      if (directory?.within !== true) {
        scanned[index] = null
        continue
      }
      const skillFilePath = join(directoryPath, "SKILL.md")
      const parsed = await parseSkillFile(skillFilePath, sourcePath)
      // A folder with no readable SKILL.md is not a skill anyone can call.
      if (parsed.content === null) {
        scanned[index] = null
        continue
      }
      const name = referenceableName(parsed.name, entry.name)
      scanned[index] = name
        ? {
            id: skillOccurrenceId(source.id, entry.name),
            directoryName: entry.name,
            skillFilePath,
            name,
            description: parsed.description ?? "",
          }
        : null
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(candidates.length, skillNameScanWorkers) },
      scanNext
    )
  )
  return scanned
    .filter((skill): skill is ScannedSkillName => skill !== null)
    .sort((left, right) => left.name.localeCompare(right.name))
}

/**
 * A `$` token ends at the first space, and a harness reaches the skill through
 * a command built from this name, so a frontmatter `name: Pull Request Review`
 * can be neither typed nor sent. Nothing validates that field on disk, so the
 * folder name — which every harness already treats as the skill's identity —
 * stands in, and a folder that cannot be named either is not offered at all.
 */
function referenceableName(
  declared: string | null,
  directoryName: string
): string | null {
  if (declared && referenceableNamePattern.test(declared)) return declared
  return referenceableNamePattern.test(directoryName) ? directoryName : null
}

const referenceableNamePattern = /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u

async function scanSkillDirectory(
  source: SkillSourceInput,
  resolvedSourcePath: string,
  directoryName: string,
  isSymbolicLink: boolean
): Promise<ScannedSkill | null> {
  const directoryPath = join(source.path, directoryName)
  const directory = await skillDirectoryTarget(
    resolvedSourcePath,
    directoryPath,
    isSymbolicLink ? join(resolvedSourcePath, directoryName) : null
  )
  if (!directory) return null
  const skillFilePath = join(directoryPath, "SKILL.md")
  if (!directory.within) {
    return {
      occurrence: {
        id: skillOccurrenceId(source.id, directoryName),
        sourceId: source.id,
        directoryName,
        directoryPath,
        resolvedDirectoryPath: directory.path,
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
  const enabled = await lstat(skillFilePath).then(
    () => true,
    () => false
  )
  const disabledPath = join(directoryPath, "SKILL.md.disabled")
  const disabled =
    !enabled &&
    (await lstat(disabledPath).then(
      () => true,
      () => false
    ))
  const readablePath = disabled ? disabledPath : skillFilePath
  const parsed = await parseSkillFile(readablePath, resolvedSourcePath)
  if (parsed.diagnostics.some(({ code }) => code === "skill-file-missing")) {
    const recoveryFiles = (await readdir(directoryPath).catch(() => [])).filter(
      isSkillRecoveryFileName
    )
    if (recoveryFiles.length > 0) {
      parsed.diagnostics = parsed.diagnostics.map((diagnostic) =>
        diagnostic.code === "skill-file-missing"
          ? {
              ...diagnostic,
              message: `A skill save was interrupted. Open this folder, compare the .deskto-skill-*.recovery files, and restore the version you want as SKILL.md. Your previous file is preserved.`,
            }
          : diagnostic
      )
    }
  }

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
      resolvedDirectoryPath: directory.path,
      enabled: !disabled,
      skillFilePath: readablePath,
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

/**
 * Where a skill folder really is, and whether it is still inside the source
 * that declared it. Both scans ask the same question, and the answer decides
 * whether a symlink out of the tree is reported or ignored — a rule that must
 * not drift between them.
 */
async function skillDirectoryTarget(
  resolvedSourcePath: string,
  path: string,
  brokenSymbolicLinkPath: string | null
): Promise<{ path: string; within: boolean } | null> {
  const target = await directoryTarget(path, brokenSymbolicLinkPath)
  if (!target) return null
  return { path: target, within: pathIsWithin(resolvedSourcePath, target) }
}

async function directoryTarget(
  path: string,
  brokenSymbolicLinkPath: string | null
): Promise<string | null> {
  try {
    if (!(await stat(path)).isDirectory()) return null
    return await realpath(path)
  } catch {
    return brokenSymbolicLinkPath
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
