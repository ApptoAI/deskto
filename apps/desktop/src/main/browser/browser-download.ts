import { randomUUID } from "node:crypto"
import { constants, createReadStream } from "node:fs"
import {
  link,
  lstat,
  mkdir,
  open,
  opendir,
  readdir,
  realpath,
  rm,
  stat,
  unlink,
  type FileHandle,
} from "node:fs/promises"
import path from "node:path"

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

/**
 * Removes staging entries left by a crash. Age is the only ownership signal:
 * Chromium touches a live download as bytes arrive and a commit finishes
 * within seconds, so an entry untouched for an hour belongs to no running
 * Deskto, including a second process sharing this user data folder.
 */
export async function scavengeBrowserDownloadStaging(
  stagingDirectory: string,
  now = Date.now()
): Promise<void> {
  const entries = await readdir(stagingDirectory).catch(() => [])
  for (const entry of entries) {
    const staged = path.join(stagingDirectory, entry)
    const info = await lstat(staged).catch(() => undefined)
    if (info && now - info.mtimeMs > staleStagingAge) {
      await rm(staged, { force: true, recursive: true }).catch(() => undefined)
    }
  }
}

const staleStagingAge = 60 * 60 * 1000

export type BrowserDownloadCommit = {
  stagedPath: string
  projectPath: string | undefined
  downloadFolder: string
  fileName: string
  /**
   * Test seam only: runs after the bytes are in the temporary file and
   * before the destination is re-verified and published, so a test can
   * swap the folder in the window a hostile page would race for.
   */
  beforePublish?: () => Promise<void>
}

export type BrowserDownloadResult =
  | { path: string }
  | { refused: string }

/** Windows has no O_NOFOLLOW; there the O_EXCL create still refuses a link. */
const noFollow = constants.O_NOFOLLOW ?? 0
const createFlags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
const maximumNameAttempts = 1_000

type Identity = { dev: number | bigint; ino: number | bigint }

function sameEntry(a: Identity, b: Identity): boolean {
  return a.dev === b.dev && a.ino === b.ino
}

/**
 * Moves a staged download under the project's download folder. Every
 * directory component is checked without following links and the physical
 * folder must sit inside the physical project. The bytes go into a uniquely
 * named temporary file created exclusively in that folder, are flushed, and
 * only then is the folder proven to still be the verified one, by real path
 * and by dev/inode, before the file is published under its final name with
 * a link that never replaces an existing entry. Node has no openat, so the
 * folder cannot be pinned for the whole write; instead the temporary file
 * is emptied through its own handle if the folder moved, so no downloaded
 * byte survives outside the project. The staged file is removed either way.
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
  // Held open until the file is published: it fixes the folder's identity
  // and, on Windows, an open handle also refuses the rename outright.
  const pinned = await opendir(physicalDirectory)
  const folder = await stat(physicalDirectory)
  try {
    return await writeThroughTemporary(input, {
      directory,
      physicalRoot,
      physicalDirectory,
      folder,
      fileName,
    })
  } finally {
    await pinned.close().catch(() => undefined)
  }
}

type VerifiedDirectory = {
  directory: string
  physicalRoot: string
  physicalDirectory: string
  folder: Identity
  fileName: string
}

async function writeThroughTemporary(
  input: BrowserDownloadCommit,
  verified: VerifiedDirectory
): Promise<BrowserDownloadResult> {
  const temporary = path.join(
    verified.directory,
    `.deskto-download-${randomUUID()}`
  )
  const handle = await open(temporary, createFlags | noFollow, 0o644)
  const created = await handle.stat()
  try {
    const placed = await lstat(temporary)
    if (!placed.isFile() || !sameEntry(placed, created)) {
      return { refused: "The download folder changed while the file was saved" }
    }
    await handle.writeFile(createReadStream(input.stagedPath))
    await handle.sync()
    await input.beforePublish?.()
    if (!(await stillVerified(verified))) {
      return { refused: "The download folder changed while the file was saved" }
    }
    const target = await publish(temporary, verified.directory, verified.fileName)
    if (!target) {
      return { refused: "No free file name in the download folder" }
    }
    const published = await lstat(target).catch(() => undefined)
    if (
      !published ||
      !sameEntry(published, created) ||
      !(await stillVerified(verified))
    ) {
      await removeIfSame(target, created)
      return { refused: "The download folder changed while the file was saved" }
    }
    await handle.close()
    await unlink(temporary).catch(() => undefined)
    return { path: target }
  } finally {
    // Reached with the handle still open only when the commit failed: the
    // temporary may now sit anywhere the folder was moved to, so its bytes
    // are dropped through the handle before the entry itself is removed.
    await discard(handle, temporary, created)
  }
}

/** The folder is still the verified one and still inside the project. */
async function stillVerified(verified: VerifiedDirectory): Promise<boolean> {
  const physical = await realpath(verified.directory).catch(() => undefined)
  if (physical !== verified.physicalDirectory) return false
  if (!pathStaysInside(verified.physicalRoot, physical)) return false
  const folder = await lstat(verified.directory).catch(() => undefined)
  return folder !== undefined && folder.isDirectory() && sameEntry(folder, verified.folder)
}

/** Links the complete file to the first free name; nothing is replaced. */
async function publish(
  temporary: string,
  directory: string,
  fileName: string
): Promise<string | undefined> {
  const extension = path.extname(fileName)
  const stem = fileName.slice(0, fileName.length - extension.length)
  for (let attempt = 1; attempt <= maximumNameAttempts; attempt += 1) {
    const name = attempt === 1 ? fileName : `${stem} (${attempt})${extension}`
    const target = path.join(directory, name)
    try {
      await link(temporary, target)
      return target
    } catch (error) {
      const taken =
        error instanceof Error && "code" in error && error.code === "EEXIST"
      if (!taken) throw error
    }
  }
  return undefined
}

async function discard(
  handle: FileHandle,
  temporary: string,
  created: Identity
): Promise<void> {
  const stillOpen = await handle.stat().catch(() => undefined)
  if (!stillOpen) return
  await handle.truncate(0).catch(() => undefined)
  await handle.close().catch(() => undefined)
  await removeIfSame(temporary, created)
}

/** Removes only the entry this commit created, never something swapped in. */
async function removeIfSame(target: string, created: Identity): Promise<void> {
  const entry = await lstat(target).catch(() => undefined)
  if (entry && sameEntry(entry, created)) {
    await rm(target, { force: true }).catch(() => undefined)
  }
}
