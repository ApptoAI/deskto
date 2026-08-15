import { execFile } from "node:child_process"
import { readdir, stat } from "node:fs/promises"
import { relative, resolve, sep } from "node:path"
import { promisify } from "node:util"

import type { ProjectEntry } from "@openappto/protocol"

const execFileAsync = promisify(execFile)
const cacheTtlMs = 15_000
const maxIndexedEntries = 25_000
const maxCachedRoots = 4
const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".turbo",
  ".venv",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
])

type CachedIndex = { createdAt: number; entries: ProjectEntry[] }
type GitIndexedEntry = { entry: ProjectEntry; resolveKind: boolean }

/** Short-lived Project path index used by the @ composer lane. */
export class ProjectEntries {
  readonly #cache = new Map<string, CachedIndex>()
  readonly #inFlight = new Map<string, Promise<ProjectEntry[]>>()

  async search(
    root: string,
    query: string,
    limit: number
  ): Promise<ProjectEntry[]> {
    const normalizedQuery = normalizePath(query).toLocaleLowerCase().trim()
    if (!normalizedQuery) return []
    const entries = await this.#entries(root)
    return entries
      .map((entry) => ({
        entry,
        score: scorePath(entry.path, normalizedQuery),
      }))
      .filter((match) => match.score !== null)
      .sort(
        (left, right) =>
          left.score! - right.score! ||
          left.entry.path.localeCompare(right.entry.path)
      )
      .slice(0, limit)
      .map((match) => match.entry)
  }

  async #entries(root: string): Promise<ProjectEntry[]> {
    const cached = this.#cache.get(root)
    if (cached && Date.now() - cached.createdAt < cacheTtlMs) {
      this.#cache.delete(root)
      this.#cache.set(root, cached)
      return cached.entries
    }
    const running = this.#inFlight.get(root)
    if (running) return running
    const build = buildIndex(root).then((entries) => {
      this.#cache.delete(root)
      if (this.#cache.size >= maxCachedRoots) {
        const oldest = this.#cache.keys().next().value
        if (oldest) this.#cache.delete(oldest)
      }
      this.#cache.set(root, { createdAt: Date.now(), entries })
      return entries
    })
    this.#inFlight.set(root, build)
    try {
      return await build
    } finally {
      this.#inFlight.delete(root)
    }
  }
}

async function buildIndex(root: string): Promise<ProjectEntry[]> {
  try {
    const [tracked, untracked] = await Promise.all([
      execFileAsync(
        "git",
        ["-C", root, "ls-files", "-z", "--stage", "--cached"],
        { maxBuffer: 8 * 1024 * 1024 }
      ),
      execFileAsync(
        "git",
        ["-C", root, "ls-files", "-z", "--others", "--exclude-standard"],
        { maxBuffer: 8 * 1024 * 1024 }
      ),
    ])
    const indexed = [
      ...tracked.stdout
        .split("\0")
        .map(parseTrackedGitEntry)
        .filter((entry): entry is GitIndexedEntry => entry !== null),
      ...untracked.stdout
        .split("\0")
        .map(parseUntrackedGitEntry)
        .filter((entry): entry is GitIndexedEntry => entry !== null),
    ].slice(0, maxIndexedEntries)
    const entries = await Promise.all(
      indexed.map((entry) => resolveEntryKind(root, entry))
    )
    return entriesWithParents(entries)
  } catch {
    return walkProject(root)
  }
}

function parseTrackedGitEntry(record: string): GitIndexedEntry | null {
  const staged = /^(\d{6}) [0-9a-f]+ \d\t/.exec(record)
  if (!staged) return null
  const path = normalizePath(record.slice(staged[0].length))
  return path
    ? {
        entry: {
          path,
          kind: staged[1] === "160000" ? "directory" : "file",
        },
        resolveKind: staged[1] === "120000",
      }
    : null
}

function parseUntrackedGitEntry(record: string): GitIndexedEntry | null {
  const path = normalizePath(record)
  return path ? { entry: { path, kind: "file" }, resolveKind: true } : null
}

async function resolveEntryKind(
  root: string,
  indexed: GitIndexedEntry
): Promise<ProjectEntry> {
  if (!indexed.resolveKind) return indexed.entry
  try {
    const metadata = await stat(resolve(root, indexed.entry.path))
    return {
      ...indexed.entry,
      kind: metadata.isDirectory() ? "directory" : "file",
    }
  } catch {
    return indexed.entry
  }
}

function entriesWithParents(indexed: ProjectEntry[]): ProjectEntry[] {
  const entries = new Map<string, ProjectEntry>()
  for (const entry of indexed) {
    entries.set(entry.path, entry)
    const parts = entry.path.split("/")
    for (let index = 1; index < parts.length; index += 1) {
      const parent = parts.slice(0, index).join("/")
      entries.set(parent, { path: parent, kind: "directory" })
    }
  }
  return [...entries.values()]
}

async function walkProject(root: string): Promise<ProjectEntry[]> {
  const entries: ProjectEntry[] = []
  const pending = [resolve(root)]
  while (pending.length > 0 && entries.length < maxIndexedEntries) {
    const directory = pending.pop()!
    let children
    try {
      children = await readdir(directory, { withFileTypes: true })
    } catch {
      continue
    }
    for (const child of children) {
      if (entries.length >= maxIndexedEntries) break
      if (child.isSymbolicLink()) continue
      if (child.isDirectory() && ignoredDirectories.has(child.name)) continue
      const absolutePath = resolve(directory, child.name)
      const path = normalizePath(relative(root, absolutePath))
      if (!path || path.startsWith(`..${sep}`) || path === "..") continue
      if (child.isDirectory()) {
        entries.push({ path, kind: "directory" })
        pending.push(absolutePath)
      } else if (child.isFile()) {
        entries.push({ path, kind: "file" })
      }
    }
  }
  return entries
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "")
}

function scorePath(path: string, query: string): number | null {
  const normalized = path.toLocaleLowerCase()
  const basename = normalized.slice(normalized.lastIndexOf("/") + 1)
  if (normalized === query || basename === query) return 0
  if (basename.startsWith(query)) return 1
  if (normalized.startsWith(query)) return 2
  if (basename.includes(query)) return 3
  if (normalized.includes(query)) return 4
  return fuzzyIncludes(normalized, query) ? 5 : null
}

function fuzzyIncludes(value: string, query: string): boolean {
  let queryIndex = 0
  for (const character of value) {
    if (character === query[queryIndex]) queryIndex += 1
    if (queryIndex === query.length) return true
  }
  return false
}
