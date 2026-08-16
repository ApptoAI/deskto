import { createHash } from "node:crypto"
import { constants } from "node:fs"
import { lstat, open, readdir, realpath } from "node:fs/promises"
import { join } from "node:path"

import { RuntimeError } from "../errors.js"
import { pathIsWithin } from "../path-boundaries.js"

export type PackContentLimits = {
  maxEntries: number
  maxFileBytes: number
  maxTotalBytes: number
  maxDepth: number
}

export const defaultPackContentLimits: PackContentLimits = {
  maxEntries: 2_000,
  maxFileBytes: 50 * 1024 * 1024,
  maxTotalBytes: 250 * 1024 * 1024,
  maxDepth: 32,
}

export type PackDigest = {
  contentDigest: string
  fileCount: number
  totalBytes: number
}

/**
 * Hashes the Pack's logical file tree. Paths and bytes affect the digest;
 * absolute location, timestamps, ownership, and permissions do not.
 */
export async function digestPackDirectory(
  root: string,
  limits: PackContentLimits = defaultPackContentLimits
): Promise<PackDigest> {
  const resolvedRoot = await realpath(root)
  const hash = createHash("sha256")
  const state = { entries: 0, fileCount: 0, totalBytes: 0 }
  await hashDirectory(resolvedRoot, resolvedRoot, "", 0, hash, state, limits)
  return {
    contentDigest: `sha256:${hash.digest("hex")}`,
    fileCount: state.fileCount,
    totalBytes: state.totalBytes,
  }
}

async function hashDirectory(
  root: string,
  absolutePath: string,
  relativePath: string,
  depth: number,
  hash: ReturnType<typeof createHash>,
  state: { entries: number; fileCount: number; totalBytes: number },
  limits: PackContentLimits
): Promise<void> {
  if (depth > limits.maxDepth)
    throw invalidPack(`Pack nesting exceeds ${limits.maxDepth} directories`)

  const resolvedPath = await realpath(absolutePath)
  if (!pathIsWithin(root, resolvedPath))
    throw invalidPack(
      `Pack directory resolves outside its root: ${relativePath}`
    )
  const directoryMetadata = await lstat(resolvedPath)
  if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink())
    throw invalidPack(`Pack directory changed while reading: ${relativePath}`)

  const entries = await readdir(resolvedPath, { withFileTypes: true })
  entries.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0
  )
  for (const entry of entries) {
    state.entries += 1
    if (state.entries > limits.maxEntries)
      throw invalidPack(`Pack contains more than ${limits.maxEntries} entries`)

    const childRelativePath = relativePath
      ? `${relativePath}/${entry.name}`
      : entry.name
    const childPath = join(resolvedPath, entry.name)
    const metadata = await lstat(childPath)

    if (metadata.isSymbolicLink())
      throw invalidPack(`Pack contains a symbolic link: ${childRelativePath}`)
    if (metadata.isDirectory()) {
      hash.update(`directory\0${childRelativePath}\0`)
      await hashDirectory(
        root,
        childPath,
        childRelativePath,
        depth + 1,
        hash,
        state,
        limits
      )
      continue
    }
    if (!metadata.isFile())
      throw invalidPack(`Pack contains a special file: ${childRelativePath}`)
    const file = await openFileWithoutFollowing(childPath, childRelativePath)
    const openedMetadata = await file.stat()
    if (!openedMetadata.isFile()) {
      await file.close()
      throw invalidPack(
        `Pack entry changed while reading: ${childRelativePath}`
      )
    }
    if (openedMetadata.size > limits.maxFileBytes) {
      await file.close()
      throw invalidPack(
        `Pack file exceeds ${limits.maxFileBytes} bytes: ${childRelativePath}`
      )
    }
    if (state.totalBytes + openedMetadata.size > limits.maxTotalBytes) {
      await file.close()
      throw invalidPack(`Pack exceeds ${limits.maxTotalBytes} bytes`)
    }

    hash.update(`file\0${childRelativePath}\0${openedMetadata.size}\0`)
    let bytesRead = 0
    try {
      for await (const chunk of file.createReadStream({ autoClose: false })) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        bytesRead += bytes.length
        if (bytesRead > limits.maxFileBytes)
          throw invalidPack(
            `Pack file exceeds ${limits.maxFileBytes} bytes: ${childRelativePath}`
          )
        hash.update(bytes)
      }
    } finally {
      await file.close()
    }
    if (bytesRead !== openedMetadata.size)
      throw invalidPack(`Pack changed while reading: ${childRelativePath}`)
    hash.update("\0")
    state.fileCount += 1
    state.totalBytes += bytesRead
  }
}

async function openFileWithoutFollowing(path: string, label: string) {
  const noFollow = process.platform === "win32" ? 0 : constants.O_NOFOLLOW
  try {
    return await open(path, constants.O_RDONLY | noFollow)
  } catch {
    throw invalidPack(`Pack file changed while reading: ${label}`)
  }
}

function invalidPack(message: string): RuntimeError {
  return new RuntimeError("invalid-pack", message)
}
