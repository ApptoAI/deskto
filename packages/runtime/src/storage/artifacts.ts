import { randomUUID } from "node:crypto"
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
  type Stats,
} from "node:fs"
import type { DatabaseSync } from "node:sqlite"
import {
  basename,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path"

import {
  isEditableArtifactPreviewKind,
  type Artifact,
  type ArtifactLocation,
  type ArtifactPreview,
  type TurnOutput,
} from "@deskto/protocol"

import { RuntimeError } from "../errors.js"
import { transaction } from "./database.js"

type ArtifactRow = {
  id: string
  project_id: string
  relative_path: string
  name: string
  media_type: string
  preview_kind: Artifact["previewKind"]
  size_bytes: number
  created_at: string
  updated_at: string
}

type TurnProjectRow = {
  project_id: string
  project_path: string
}

type OutputRow = ArtifactRow & {
  turn_id: string
  produced_at: string
  project_path: string
}

const textPreviewLimit = 1_000_000
const binaryPreviewLimit = 10_000_000
const officePreviewLimit = 20_000_000
const capturedFilesLimit = 200

type ArtifactFormat = Pick<Artifact, "mediaType" | "previewKind">

const formats = new Map<string, ArtifactFormat>([
  [".md", { mediaType: "text/markdown", previewKind: "markdown" }],
  [".markdown", { mediaType: "text/markdown", previewKind: "markdown" }],
  [".csv", { mediaType: "text/csv", previewKind: "csv" }],
  [".txt", { mediaType: "text/plain", previewKind: "text" }],
  [".log", { mediaType: "text/plain", previewKind: "text" }],
  [".json", { mediaType: "application/json", previewKind: "text" }],
  [".yaml", { mediaType: "text/yaml", previewKind: "text" }],
  [".yml", { mediaType: "text/yaml", previewKind: "text" }],
  [".xml", { mediaType: "application/xml", previewKind: "text" }],
  [".html", { mediaType: "text/html", previewKind: "html" }],
  [".htm", { mediaType: "text/html", previewKind: "html" }],
  [".css", { mediaType: "text/css", previewKind: "text" }],
  [".js", { mediaType: "text/javascript", previewKind: "text" }],
  [".jsx", { mediaType: "text/javascript", previewKind: "text" }],
  [".ts", { mediaType: "text/typescript", previewKind: "text" }],
  [".tsx", { mediaType: "text/typescript", previewKind: "text" }],
  [".py", { mediaType: "text/x-python", previewKind: "text" }],
  [".sql", { mediaType: "application/sql", previewKind: "text" }],
  [".sh", { mediaType: "application/x-sh", previewKind: "text" }],
  [".pdf", { mediaType: "application/pdf", previewKind: "pdf" }],
  [
    ".xlsx",
    {
      mediaType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      previewKind: "spreadsheet",
    },
  ],
  [
    ".docx",
    {
      mediaType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      previewKind: "document",
    },
  ],
  [".png", { mediaType: "image/png", previewKind: "image" }],
  [".jpg", { mediaType: "image/jpeg", previewKind: "image" }],
  [".jpeg", { mediaType: "image/jpeg", previewKind: "image" }],
  [".gif", { mediaType: "image/gif", previewKind: "image" }],
  [".webp", { mediaType: "image/webp", previewKind: "image" }],
  [".avif", { mediaType: "image/avif", previewKind: "image" }],
])

/**
 * Extensions the Surface may hand to the operating system. Handing a path to
 * the shell means "launch whatever claims this type", and an agent chooses
 * both the name and the contents of every file it writes, so this list is
 * spelled out rather than derived from the formats above: a preview format is
 * not automatically safe to launch.
 *
 * Excluded on purpose, and each for a reason:
 *   - `.sh`, `.py`, `.js`, `.ts`, `.sql` run as programs on at least one
 *     platform;
 *   - `.html`, `.svg`, `.xml` open in a browser from a local origin and can
 *     script and phone home;
 *   - `.xlsm`, `.doc`, `.xls`, `.ppt`, `.rtf` carry macros, and a file written
 *     locally has no mark of the web, so Office skips Protected View.
 */
const openableExtensions: ReadonlySet<string> = new Set([
  ".pdf",
  ".txt",
  ".log",
  ".md",
  ".markdown",
  ".csv",
  ".json",
  ".yaml",
  ".yml",
  ".docx",
  ".xlsx",
  ".pptx",
  ".odt",
  ".ods",
  ".odp",
  ".pages",
  ".numbers",
  ".key",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".bmp",
  ".tiff",
  ".heic",
])

function isOpenableArtifactPath(path: string): boolean {
  return openableExtensions.has(extname(path).toLowerCase())
}

export class Artifacts {
  constructor(private readonly database: DatabaseSync) {}

  /** Resolves files before the caller opens its write transaction. */
  prepareCapture(
    turnId: string,
    paths: string[]
  ): PreparedArtifactCapture | undefined {
    // SAFETY: the joins select the two non-null text columns in TurnProjectRow
    // and turns.id limits the result to one row or undefined.
    const turn = this.database
      .prepare(
        `SELECT projects.id AS project_id, projects.path AS project_path
         FROM turns
         JOIN threads ON threads.id = turns.thread_id
         JOIN projects ON projects.id = threads.project_id
         WHERE turns.id = ?`
      )
      .get(turnId) as TurnProjectRow | undefined
    if (!turn) return undefined

    const seen = new Set<string>()
    const files = paths.slice(0, capturedFilesLimit).flatMap((path) => {
      const resolved = safeProjectFile(turn.project_path, path)
      if (!resolved || seen.has(resolved.relativePath)) return []
      seen.add(resolved.relativePath)
      return [resolved]
    })

    return { projectId: turn.project_id, turnId, files }
  }

  /** Records a capture prepared before the surrounding write transaction. */
  capture(prepared: PreparedArtifactCapture): Artifact[] {
    return transaction(this.database, () =>
      prepared.files.map((file) =>
        this.#captureFile(prepared.projectId, prepared.turnId, file)
      )
    )
  }

  listForThread(threadId: string): TurnOutput[] {
    // SAFETY: the CTE selects every ArtifactRow column plus the three non-null
    // OutputRow fields named by the query.
    const rows = this.database
      .prepare(
        `WITH ranked_outputs AS (
           SELECT turn_outputs.turn_id, turn_outputs.artifact_id,
                  turn_outputs.created_at AS produced_at,
                  ROW_NUMBER() OVER (
                    PARTITION BY turn_outputs.artifact_id
                    ORDER BY turn_outputs.created_at DESC, turn_outputs.rowid DESC
                  ) AS rank
           FROM turn_outputs
           JOIN turns ON turns.id = turn_outputs.turn_id
           WHERE turns.thread_id = ?
         )
         SELECT artifacts.*, ranked_outputs.turn_id, ranked_outputs.produced_at,
                projects.path AS project_path
         FROM ranked_outputs
         JOIN artifacts ON artifacts.id = ranked_outputs.artifact_id
         JOIN projects ON projects.id = artifacts.project_id
         WHERE ranked_outputs.rank = 1
         ORDER BY ranked_outputs.produced_at DESC, artifacts.name COLLATE NOCASE`
      )
      .all(threadId) as OutputRow[]

    return rows.flatMap((row) => {
      const file = safeProjectFile(row.project_path, row.relative_path)
      if (!file) return []
      return [
        {
          turnId: row.turn_id,
          producedAt: row.produced_at,
          artifact: toArtifact(row, file.stats),
        },
      ]
    })
  }

  /**
   * The validated absolute path, so the Surface can hand the file to the
   * operating system without ever resolving a path of its own.
   */
  locate(threadId: string, artifactId: string): ArtifactLocation {
    const { file } = this.#openArtifact(threadId, artifactId)
    return {
      artifactId,
      absolutePath: file.absolutePath,
      device: String(file.stats.dev),
      inode: String(file.stats.ino),
      // Read from the resolved file: a symlink inside the Project could point
      // a harmless-looking name at a different extension.
      openable: isOpenableArtifactPath(file.relativePath),
    }
  }

  preview(threadId: string, artifactId: string): ArtifactPreview {
    const { row, file } = this.#openArtifact(threadId, artifactId)

    if (row.preview_kind === "unsupported") {
      return { kind: "unsupported", artifactId }
    }
    const limit =
      row.preview_kind === "text" ||
      row.preview_kind === "markdown" ||
      row.preview_kind === "csv" ||
      row.preview_kind === "html"
        ? textPreviewLimit
        : row.preview_kind === "spreadsheet" || row.preview_kind === "document"
          ? officePreviewLimit
          : binaryPreviewLimit
    const data = readSafeProjectFile(file, limit)
    if (
      row.preview_kind === "text" ||
      row.preview_kind === "markdown" ||
      row.preview_kind === "csv" ||
      row.preview_kind === "html"
    ) {
      return {
        kind: row.preview_kind,
        artifactId,
        content: data.toString("utf8"),
      }
    }
    if (row.preview_kind === "image") {
      return {
        kind: "image",
        artifactId,
        dataUrl: `data:${row.media_type};base64,${data.toString("base64")}`,
      }
    }
    if (row.preview_kind === "spreadsheet" || row.preview_kind === "document") {
      return {
        kind: row.preview_kind,
        artifactId,
        dataBase64: data.toString("base64"),
      }
    }
    return { kind: "pdf", artifactId, dataBase64: data.toString("base64") }
  }

  /**
   * Replaces the file behind an editable Artifact. The write is refused when
   * the file changed after the editor loaded it, so an agent edit that lands
   * mid-session survives instead of being clobbered by a stale draft.
   */
  write(
    threadId: string,
    artifactId: string,
    content: string,
    baseUpdatedAt: string
  ): Artifact {
    const { row, file } = this.#openArtifact(threadId, artifactId)
    if (!isEditableArtifactPreviewKind(row.preview_kind)) {
      throw new RuntimeError(
        "artifact-read-only",
        "This result cannot be edited here"
      )
    }
    if (modifiedAt(file.stats) !== baseUpdatedAt) {
      throw new RuntimeError(
        "artifact-conflict",
        "This file changed after it was opened. Reload the result before saving again."
      )
    }
    const data = Buffer.from(content, "utf8")
    if (data.byteLength > textPreviewLimit) {
      throw new RuntimeError(
        "artifact-too-large",
        `This result is too large to save (${formatBytes(data.byteLength)})`
      )
    }

    const stats = writeSafeProjectFile(file, data)
    // The row keeps the file's own timestamp rather than a wall clock, so the
    // stored version and the one an editor compares against never disagree.
    this.database
      .prepare(
        "UPDATE artifacts SET size_bytes = ?, updated_at = ? WHERE id = ?"
      )
      .run(stats.size, modifiedAt(stats), artifactId)

    return toArtifact(row, stats)
  }

  /** Thread-scoped lookup shared by every read and write of one Artifact. */
  #openArtifact(threadId: string, artifactId: string) {
    // SAFETY: the query selects every ArtifactRow column plus a non-null
    // project_path, and artifacts.id permits at most one row.
    const row = this.database
      .prepare(
        `SELECT artifacts.*, projects.path AS project_path
         FROM artifacts
         JOIN projects ON projects.id = artifacts.project_id
         WHERE artifacts.id = ?
           AND EXISTS (
             SELECT 1
             FROM turn_outputs
             JOIN turns ON turns.id = turn_outputs.turn_id
             WHERE turn_outputs.artifact_id = artifacts.id
               AND turns.thread_id = ?
           )`
      )
      .get(artifactId, threadId) as
      | (ArtifactRow & { project_path: string })
      | undefined
    if (!row) throw new RuntimeError("artifact-not-found", "Result not found")

    const file = safeProjectFile(row.project_path, row.relative_path)
    if (!file)
      throw new RuntimeError(
        "artifact-unavailable",
        "This result is no longer available in the project folder"
      )
    return { row, file }
  }

  #captureFile(
    projectId: string,
    turnId: string,
    file: SafeProjectFile
  ): Artifact {
    const now = new Date().toISOString()
    const fileUpdatedAt = modifiedAt(file.stats)
    const format = formatFor(file.relativePath)
    // SAFETY: the unique project/path lookup selects a complete ArtifactRow or
    // returns undefined when this is the first capture.
    const existing = this.database
      .prepare(
        "SELECT * FROM artifacts WHERE project_id = ? AND relative_path = ?"
      )
      .get(projectId, file.relativePath) as ArtifactRow | undefined
    const id = existing?.id ?? randomUUID()
    if (existing) {
      this.database
        .prepare(
          "UPDATE artifacts SET name = ?, media_type = ?, preview_kind = ?, size_bytes = ?, updated_at = ? WHERE id = ?"
        )
        .run(
          basename(file.relativePath),
          format.mediaType,
          format.previewKind,
          file.stats.size,
          fileUpdatedAt,
          id
        )
    } else {
      this.database
        .prepare(
          "INSERT INTO artifacts (id, project_id, relative_path, name, media_type, preview_kind, size_bytes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run(
          id,
          projectId,
          file.relativePath,
          basename(file.relativePath),
          format.mediaType,
          format.previewKind,
          file.stats.size,
          now,
          fileUpdatedAt
        )
    }
    this.database
      .prepare(
        `INSERT INTO turn_outputs (turn_id, artifact_id, created_at)
         VALUES (?, ?, ?)
         ON CONFLICT(turn_id, artifact_id) DO UPDATE SET created_at = excluded.created_at`
      )
      .run(turnId, id, now)

    return {
      id,
      projectId,
      name: basename(file.relativePath),
      relativePath: file.relativePath,
      mediaType: format.mediaType,
      previewKind: format.previewKind,
      openable: isOpenableArtifactPath(file.relativePath),
      sizeBytes: file.stats.size,
      createdAt: existing?.created_at ?? now,
      updatedAt: modifiedAt(file.stats),
    }
  }
}

type SafeProjectFile = {
  absolutePath: string
  relativePath: string
  stats: Stats
}

export type PreparedArtifactCapture = {
  projectId: string
  turnId: string
  files: SafeProjectFile[]
}

function safeProjectFile(
  projectPath: string,
  reportedPath: string
): SafeProjectFile | undefined {
  if (!reportedPath || reportedPath.includes("\0")) return undefined
  try {
    const root = realpathSync(projectPath)
    const candidate = isAbsolute(reportedPath)
      ? reportedPath
      : resolve(root, reportedPath)
    const absolutePath = realpathSync(candidate)
    const relativePath = relative(root, absolutePath)
    if (
      relativePath === "" ||
      relativePath === ".." ||
      relativePath.startsWith(`..${sep}`) ||
      isAbsolute(relativePath)
    )
      return undefined
    const stats = statSync(absolutePath)
    if (!stats.isFile()) return undefined
    return {
      absolutePath,
      relativePath: relativePath.split(sep).join("/"),
      stats,
    }
  } catch {
    return undefined
  }
}

function formatFor(path: string): ArtifactFormat {
  return (
    formats.get(extname(path).toLowerCase()) ?? {
      mediaType: "application/octet-stream",
      previewKind: "unsupported",
    }
  )
}

function readSafeProjectFile(file: SafeProjectFile, limit: number): Buffer {
  let descriptor: number | undefined
  try {
    descriptor = openSync(
      file.absolutePath,
      constants.O_RDONLY | constants.O_NOFOLLOW
    )
    const opened = fstatSync(descriptor)
    if (
      !opened.isFile() ||
      opened.dev !== file.stats.dev ||
      opened.ino !== file.stats.ino
    ) {
      throw new RuntimeError(
        "artifact-unavailable",
        "This result changed while the preview was opening"
      )
    }
    if (opened.size > limit) {
      throw new RuntimeError(
        "artifact-too-large",
        `This result is too large to preview (${formatBytes(opened.size)})`
      )
    }

    // Read from the validated handle, not the path. The extra byte catches a
    // file that grows past the limit after fstat without allocating unbounded
    // memory in the Electron main process.
    const data = Buffer.allocUnsafe(limit + 1)
    let offset = 0
    while (offset < data.length) {
      const bytesRead = readSync(
        descriptor,
        data,
        offset,
        data.length - offset,
        null
      )
      if (bytesRead === 0) break
      offset += bytesRead
    }
    if (offset > limit) {
      throw new RuntimeError(
        "artifact-too-large",
        `This result is too large to preview (more than ${formatBytes(limit)})`
      )
    }
    return data.subarray(0, offset)
  } catch (error) {
    if (error instanceof RuntimeError) throw error
    throw new RuntimeError(
      "artifact-unavailable",
      "This result is no longer available in the project folder"
    )
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

/**
 * Writes the whole file or none of it. The data lands in a sibling temp file
 * that is renamed over the target, so a disk filling up or a process dying
 * mid-write leaves the user's original untouched rather than truncated.
 *
 * The target is confirmed to be the same inode the containment check
 * resolved, so a symlink or a swap arriving in between cannot redirect the
 * rename onto another file.
 */
function writeSafeProjectFile(file: SafeProjectFile, data: Buffer): Stats {
  const temporaryPath = `${file.absolutePath}.deskto-${randomUUID().slice(0, 8)}`
  let descriptor: number | undefined
  try {
    const target = statSync(file.absolutePath)
    if (
      !target.isFile() ||
      target.dev !== file.stats.dev ||
      target.ino !== file.stats.ino
    ) {
      throw new RuntimeError(
        "artifact-unavailable",
        "This result changed while it was being saved"
      )
    }

    // O_EXCL: never write through a name something else already created.
    descriptor = openSync(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      target.mode
    )
    // openSync applies the process umask even when a mode is supplied. Restore
    // the original permissions before the temp file replaces the target.
    fchmodSync(descriptor, target.mode)
    let offset = 0
    while (offset < data.byteLength) {
      offset += writeSync(
        descriptor,
        data,
        offset,
        data.byteLength - offset,
        offset
      )
    }
    closeSync(descriptor)
    descriptor = undefined

    renameSync(temporaryPath, file.absolutePath)
    return statSync(file.absolutePath)
  } catch (error) {
    if (descriptor !== undefined) {
      closeSync(descriptor)
      descriptor = undefined
    }
    rmSync(temporaryPath, { force: true })
    if (error instanceof RuntimeError) throw error
    // The operating system's own reason is what makes a save failure
    // actionable: a full disk and a read-only folder need different answers.
    const reason =
      error instanceof Error && "code" in error
        ? String(error.code)
        : String(error)
    throw new RuntimeError(
      "artifact-unavailable",
      `This result could not be saved to the project folder. ${reason}`
    )
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

/**
 * Size and `updatedAt` come from the file rather than the captured row: the
 * Project folder is the source of truth, and an editor needs the on-disk
 * version to detect a conflicting write.
 */
function toArtifact(row: ArtifactRow, stats: Stats): Artifact {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    relativePath: row.relative_path,
    mediaType: row.media_type,
    previewKind: row.preview_kind,
    openable: isOpenableArtifactPath(row.relative_path),
    sizeBytes: stats.size,
    createdAt: row.created_at,
    updatedAt: modifiedAt(stats),
  }
}

function modifiedAt(stats: Stats): string {
  return new Date(stats.mtimeMs).toISOString()
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.ceil(bytes / 1_000)} KB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}
