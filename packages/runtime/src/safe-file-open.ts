import { constants, type Dirent, type Stats } from "node:fs"
import {
  lstat,
  open,
  opendir,
  realpath,
  type FileHandle,
} from "node:fs/promises"

import { pathIsWithin } from "./path-boundaries.js"

export type OpenedRegularFile = {
  handle: FileHandle
  metadata: Stats
}

/**
 * Opens a regular file and proves that the opened object is still the object
 * reachable at a path inside root. The identity check also covers Windows,
 * where O_NOFOLLOW is unavailable.
 */
export async function openRegularFileWithinRoot(
  path: string,
  root: string
): Promise<OpenedRegularFile> {
  const noFollow = process.platform === "win32" ? 0 : constants.O_NOFOLLOW
  const handle = await open(path, constants.O_RDONLY | noFollow)
  try {
    const metadata = await handle.stat()
    const pathMetadata = await lstat(path)
    const resolvedPath = await realpath(path)
    const resolvedMetadata = await lstat(resolvedPath)
    if (
      !metadata.isFile() ||
      pathMetadata.isSymbolicLink() ||
      !pathMetadata.isFile() ||
      !resolvedMetadata.isFile() ||
      !pathIsWithin(root, resolvedPath) ||
      !isSameFile(metadata, pathMetadata) ||
      !isSameFile(metadata, resolvedMetadata)
    )
      throw new Error("Path is not a stable regular file inside its root")
    return { handle, metadata }
  } catch (error) {
    await handle.close()
    throw error
  }
}

/**
 * Reads a directory, then verifies that the path still resolves to the same
 * in-root directory. Callers validate every opened child independently.
 */
export async function readDirectoryWithinRoot(
  path: string,
  root: string
): Promise<Dirent[]> {
  const before = await lstat(path)
  if (!before.isDirectory() || before.isSymbolicLink())
    throw new Error("Path is not a directory")

  const resolvedBefore = await realpath(path)
  if (!pathIsWithin(root, resolvedBefore))
    throw new Error("Directory resolves outside its root")

  const resolvedBeforeMetadata = await lstat(resolvedBefore)
  if (
    !resolvedBeforeMetadata.isDirectory() ||
    resolvedBeforeMetadata.isSymbolicLink() ||
    !isSameFile(before, resolvedBeforeMetadata)
  )
    throw new Error("Directory changed before it was opened")

  const directory = await opendir(resolvedBefore)
  const entries: Dirent[] = []
  try {
    for (;;) {
      const entry = await directory.read()
      if (!entry) break
      entries.push(entry)
    }
  } finally {
    await directory.close()
  }

  const after = await lstat(path)
  const resolvedAfter = await realpath(path)
  const resolvedAfterMetadata = await lstat(resolvedAfter)
  if (
    !after.isDirectory() ||
    after.isSymbolicLink() ||
    !resolvedAfterMetadata.isDirectory() ||
    resolvedAfterMetadata.isSymbolicLink() ||
    !pathIsWithin(root, resolvedAfter) ||
    resolvedAfter !== resolvedBefore ||
    !isSameFile(before, after) ||
    !isSameFile(before, resolvedAfterMetadata)
  )
    throw new Error("Directory changed while it was being read")

  return entries
}

function isSameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}
