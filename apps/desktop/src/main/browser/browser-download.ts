import { randomUUID } from "node:crypto"
import { constants, createReadStream } from "node:fs"
import {
  lstat,
  mkdir,
  open,
  realpath,
  rm,
  type FileHandle,
} from "node:fs/promises"
import path from "node:path"
import { pipeline } from "node:stream/promises"

import {
  browserDownloadDirectory,
  pathStaysInside,
} from "./browser-settings.js"

/**
 * Chromium writes a download wherever the save path points when the bytes
 * arrive, long after the path was checked. So it writes into a staging file
 * under Deskto's own data folder, and the bytes reach the project only
 * through `commitBrowserDownload`, which re-verifies the destination at the
 * moment it writes.
 */
export function stageBrowserDownload(stagingDirectory: string): string {
  return path.join(stagingDirectory, randomUUID())
}

export type BrowserDownloadCommit = {
  stagedPath: string
  projectPath: string | undefined
  downloadFolder: string
  fileName: string
}

export type BrowserDownloadResult =
  | { path: string }
  | { refused: string }

/** Windows has no O_NOFOLLOW; there the O_EXCL create still refuses a link. */
const noFollow = constants.O_NOFOLLOW ?? 0
const createFlags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
const maximumNameAttempts = 1_000

/**
 * Moves a staged download under the project's download folder. Every
 * directory component is checked without following links, the physical
 * folder must still sit inside the physical project, the destination is
 * created exclusively so nothing existing is overwritten and no link is
 * followed, and the open handle is proven to be the entry at that verified
 * path before a byte is written. The staged file is removed either way.
 */
export async function commitBrowserDownload(
  input: BrowserDownloadCommit
): Promise<BrowserDownloadResult> {
  try {
    return await moveStagedDownload(input)
  } catch (error) {
    return { refused: error instanceof Error ? error.message : String(error) }
  } finally {
    await rm(input.stagedPath, { force: true }).catch(() => undefined)
  }
}

async function moveStagedDownload(
  input: BrowserDownloadCommit
): Promise<BrowserDownloadResult> {
  const { projectPath, downloadFolder, fileName } = input
  const directory = browserDownloadDirectory(projectPath, downloadFolder)
  if (!projectPath || !directory) {
    return { refused: "The download folder is not inside the project" }
  }
  const root = path.resolve(projectPath)
  const physicalRoot = await realpath(root)
  let current = root
  for (const segment of path.relative(root, directory).split(path.sep)) {
    current = path.join(current, segment)
    const entry = await lstat(current).catch(() => undefined)
    if (!entry) {
      await mkdir(current)
    } else if (entry.isSymbolicLink() || !entry.isDirectory()) {
      return { refused: `${current} is not a folder inside the project` }
    }
  }
  const physicalDirectory = await realpath(directory)
  if (!pathStaysInside(physicalRoot, physicalDirectory)) {
    return { refused: "The download folder leads outside the project" }
  }

  const created = await createExclusive(directory, fileName)
  if (!created) {
    return { refused: "No free file name in the download folder" }
  }
  const { handle, target } = created
  try {
    const opened = await handle.stat()
    const physicalTarget = await realpath(target)
    const placed = await lstat(physicalTarget)
    const proven =
      path.dirname(physicalTarget) === physicalDirectory &&
      placed.isFile() &&
      placed.dev === opened.dev &&
      placed.ino === opened.ino
    if (!proven) {
      await handle.close()
      await removeIfSame(target, opened)
      return { refused: "The download folder changed while the file was saved" }
    }
    await pipeline(
      createReadStream(input.stagedPath),
      handle.createWriteStream()
    )
    return { path: target }
  } catch (error) {
    await handle.close().catch(() => undefined)
    await removeIfSame(target, await handle.stat().catch(() => undefined))
    throw error
  }
}

/** The first free name for the file, held open exclusively. */
async function createExclusive(
  directory: string,
  fileName: string
): Promise<{ handle: FileHandle; target: string } | undefined> {
  const extension = path.extname(fileName)
  const stem = fileName.slice(0, fileName.length - extension.length)
  for (let attempt = 1; attempt <= maximumNameAttempts; attempt += 1) {
    const name = attempt === 1 ? fileName : `${stem} (${attempt})${extension}`
    const target = path.join(directory, name)
    try {
      const handle = await open(target, createFlags | noFollow, 0o644)
      return { handle, target }
    } catch (error) {
      const taken =
        error instanceof Error && "code" in error && error.code === "EEXIST"
      if (!taken) throw error
    }
  }
  return undefined
}

/** Removes only the entry this commit created, never something swapped in. */
async function removeIfSame(
  target: string,
  created: { dev: number | bigint; ino: number | bigint } | undefined
): Promise<void> {
  if (!created) return
  const entry = await lstat(target).catch(() => undefined)
  if (entry && entry.dev === created.dev && entry.ino === created.ino) {
    await rm(target, { force: true }).catch(() => undefined)
  }
}
