import { randomUUID } from "node:crypto"
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
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

import type { Artifact, ArtifactPreview, TurnOutput } from "@openappto/protocol"

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
      const artifact = toArtifact({
        ...row,
        size_bytes: file.stats.size,
      })
      return [{ turnId: row.turn_id, producedAt: row.produced_at, artifact }]
    })
  }

  preview(threadId: string, artifactId: string): ArtifactPreview {
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

  #captureFile(
    projectId: string,
    turnId: string,
    file: SafeProjectFile
  ): Artifact {
    const now = new Date().toISOString()
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
          now,
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
          now
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
      sizeBytes: file.stats.size,
      createdAt: existing?.created_at ?? now,
      updatedAt: now,
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

function toArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    relativePath: row.relative_path,
    mediaType: row.media_type,
    previewKind: row.preview_kind,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.ceil(bytes / 1_000)} KB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}
