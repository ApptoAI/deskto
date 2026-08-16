import { readdir, stat } from "node:fs/promises"
import { resolve } from "node:path"

import { workingDirectoryNames } from "./storage/artifacts.js"

/**
 * Files a Turn produced through work that named no path, such as a document
 * written by `python3 make-report.py`. A sweep only proposes paths;
 * `Artifacts.prepareCapture` still decides what becomes a result.
 */

const maxScannedFiles = 25_000
const maximumConcurrentStats = 32
const minimumSweepGapMs = 1_000
/** Each sweep waits a multiple of what the last walk cost. */
const sweepGapFactor = 4

/** Machinery, not deliverables. Dot-directories are skipped for the same reason. */
const buildDirectoryNames: ReadonlySet<string> = new Set([
  "build",
  "coverage",
  "dist",
  "out",
  "target",
  "vendor",
])

type ScannedFile = { signature: string; modifiedAt: number }

export class ProjectOutputSweep {
  #files: Map<string, ScannedFile>
  #running = false
  #requested = false
  #everRequested = false
  #nextSweepAt = 0
  #timer?: ReturnType<typeof setTimeout>
  #closed = false
  #settled: Promise<void> = Promise.resolve()
  #finishing?: Promise<void>

  private constructor(
    private readonly root: string,
    files: Map<string, ScannedFile>,
    private readonly onProduced: (paths: string[]) => void
  ) {
    this.#files = files
  }

  /**
   * Returns nothing when the folder is unreadable or too large; the Turn then
   * captures from Activities only. `onProduced` owns its own failures.
   */
  static async begin(
    root: string,
    onProduced: (paths: string[]) => void
  ): Promise<ProjectOutputSweep | undefined> {
    const files = await scanProject(root)
    return files ? new ProjectOutputSweep(root, files, onProduced) : undefined
  }

  request(): void {
    this.#requested = true
    this.#everRequested = true
    this.#drain()
  }

  /**
   * Final sweep, past the cool-down. A Turn that never asked for one gets
   * none: its Harness already described every file it touched.
   */
  finish(): Promise<void> {
    this.#finishing ??= this.#finish()
    return this.#finishing
  }

  async #finish(): Promise<void> {
    if (this.#closed) return
    const warranted = this.#everRequested
    this.close()
    await this.#settled
    if (warranted) await this.#sweep()
  }

  close(): void {
    this.#closed = true
    this.#requested = false
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = undefined
  }

  #drain(): void {
    if (this.#closed || this.#running || !this.#requested) return
    const wait = this.#nextSweepAt - Date.now()
    if (wait > 0) {
      this.#timer ??= setTimeout(() => {
        this.#timer = undefined
        this.#drain()
      }, wait)
      return
    }
    this.#requested = false
    this.#running = true
    this.#settled = this.#sweep().finally(() => {
      this.#running = false
      this.#drain()
    })
  }

  async #sweep(): Promise<void> {
    const startedAt = Date.now()
    const scanned = await scanProject(this.root)
    this.#nextSweepAt =
      Date.now() +
      Math.max(minimumSweepGapMs, (Date.now() - startedAt) * sweepGapFactor)
    // Keep the old snapshot when the folder outgrew the limit mid-Turn.
    if (!scanned) return

    const produced: { path: string; modifiedAt: number }[] = []
    for (const [path, file] of scanned) {
      if (this.#files.get(path)?.signature === file.signature) continue
      produced.push({ path, modifiedAt: file.modifiedAt })
    }
    this.#files = scanned
    if (produced.length === 0) return

    // Capture keeps only the first 200 paths, so offer the newest first.
    produced.sort(
      (left, right) =>
        right.modifiedAt - left.modifiedAt ||
        left.path.localeCompare(right.path)
    )
    this.onProduced(produced.map((file) => file.path))
  }
}

async function scanProject(
  root: string
): Promise<Map<string, ScannedFile> | undefined> {
  const paths: string[] = []
  const pending = [resolve(root)]
  while (pending.length > 0) {
    const directory = pending.pop()!
    let children
    try {
      children = await readdir(directory, { withFileTypes: true })
    } catch {
      continue
    }
    for (const child of children) {
      // Following a symlink would make the walk unbounded.
      if (child.isSymbolicLink()) continue
      const path = resolve(directory, child.name)
      if (child.isDirectory()) {
        if (child.name.startsWith(".") || isSkippedDirectory(child.name))
          continue
        pending.push(path)
      } else if (child.isFile()) {
        if (paths.length === maxScannedFiles) return undefined
        paths.push(path)
      }
    }
  }

  const files = new Map<string, ScannedFile>()
  let nextPath = 0
  const scanNext = async () => {
    while (nextPath < paths.length) {
      const path = paths[nextPath++]!
      const scanned = await scanFile(path)
      if (scanned) files.set(scanned.path, scanned.file)
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(maximumConcurrentStats, paths.length) },
      scanNext
    )
  )
  return files
}

async function scanFile(
  path: string
): Promise<{ path: string; file: ScannedFile } | undefined> {
  try {
    const metadata = await stat(path)
    return {
      path,
      file: {
        // A safe write replaces the file by rename, so identity is the inode.
        signature: `${metadata.mtimeMs}:${metadata.size}:${metadata.ino}`,
        modifiedAt: metadata.mtimeMs,
      },
    }
  } catch {
    return undefined
  }
}

function isSkippedDirectory(name: string): boolean {
  const normalized = name.toLowerCase()
  return (
    workingDirectoryNames.has(normalized) || buildDirectoryNames.has(normalized)
  )
}
