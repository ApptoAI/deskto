import { readdir, stat } from "node:fs/promises"
import path from "node:path"

import { browserProfilePartition } from "@deskto/protocol"

/**
 * Electron keeps a persistent partition under `Partitions/<name>` in the
 * user data directory, lower-cased and path-escaped, with the `persist:`
 * prefix removed. `session.storagePath` reports the same folder once a
 * session exists; this derivation lets the settings page size a profile
 * without creating a session for every Workspace.
 */
export function browserProfilePath(
  userDataPath: string,
  workspaceId: string
): string {
  const name = browserProfilePartition(workspaceId).replace(/^persist:/, "")
  return path.join(userDataPath, "Partitions", escapePartitionName(name))
}

function escapePartitionName(name: string): string {
  return encodeURIComponent(name.toLowerCase()).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  )
}

export type BrowserProfileUsage = {
  sizeBytes: number
  lastUsedAt: string | null
}

/**
 * Walks the profile folder summing file sizes; the newest write stands in
 * for "last used" because Chromium touches cookies and cache while a page
 * is open, and a missing folder means the browser never opened here.
 */
export async function measureBrowserProfile(
  profilePath: string
): Promise<BrowserProfileUsage> {
  let sizeBytes = 0
  let newest = 0
  const pending = [profilePath]
  while (pending.length > 0) {
    const directory = pending.pop()
    if (!directory) break
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        pending.push(entryPath)
        continue
      }
      if (!entry.isFile()) continue
      try {
        const info = await stat(entryPath)
        sizeBytes += info.size
        newest = Math.max(newest, info.mtimeMs)
      } catch {
        continue
      }
    }
  }
  return {
    sizeBytes,
    lastUsedAt: newest > 0 ? new Date(newest).toISOString() : null,
  }
}
