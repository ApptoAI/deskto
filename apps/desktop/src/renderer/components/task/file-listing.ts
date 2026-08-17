import type { TurnOutput } from "@deskto/protocol"

/**
 * One folder in the Files list. `path` is project-relative with no trailing
 * slash; the root folder is the empty string.
 */
export type FolderRow = {
  kind: "folder"
  path: string
  /**
   * What the row prints. A chain of folders that holds nothing but the next
   * folder collapses into one row — `src/renderer/components` rather than
   * three clicks that each show a single row.
   */
  name: string
  fileCount: number
}

export type FileRow = {
  kind: "file"
  output: TurnOutput
}

export type FileListRow = FolderRow | FileRow

/**
 * The rows one folder holds: its folders first, then its own files.
 *
 * Neither group is sorted here. The Runtime hands files back newest first,
 * and a list that reordered them alphabetically would lose the one ordering
 * the user came for; a folder takes the place of the newest file beneath it.
 */
export function listFolder(
  outputs: TurnOutput[],
  folder: string
): FileListRow[] {
  const prefix = folder ? `${folder}/` : ""
  const files: FileRow[] = []
  const order: string[] = []
  const beneath = new Map<string, string[]>()

  for (const output of outputs) {
    const path = output.artifact.relativePath
    if (!path.startsWith(prefix)) continue
    const rest = path.slice(prefix.length)
    const cut = rest.indexOf("/")
    if (cut < 0) {
      files.push({ kind: "file", output })
      continue
    }
    const segment = rest.slice(0, cut)
    const group = beneath.get(segment)
    if (group) {
      group.push(rest.slice(cut + 1))
      continue
    }
    order.push(segment)
    beneath.set(segment, [rest.slice(cut + 1)])
  }

  const folders = order.map((segment): FolderRow => {
    const rest = beneath.get(segment) ?? []
    const chain = sharedFolderPath(rest)
    return {
      kind: "folder",
      path: [folder, segment, chain].filter(Boolean).join("/"),
      name: chain ? `${segment}/${chain}` : segment,
      fileCount: rest.length,
    }
  })
  return [...folders, ...files]
}

/**
 * The deepest folder holding every one of these files, or the root when they
 * are spread across the Project. It is where the list has to stand for all of
 * them to be in view at once.
 */
export function sharedFolder(outputs: TurnOutput[]): string {
  return sharedFolderPath(outputs.map((output) => output.artifact.relativePath))
}

/**
 * The nearest folder that still holds something, for a path the task has
 * moved past — a file deleted from disk takes its folder with it, and the
 * list would otherwise sit empty with no row to climb back out by.
 */
export function resolveFolder(outputs: TurnOutput[], folder: string): string {
  let current = folder
  while (current && !holdsFiles(outputs, current)) {
    current = parentFolder(current)
  }
  return current
}

/** The folder a path sits in, or the root for a path with no folder. */
export function parentFolder(path: string): string {
  const end = path.lastIndexOf("/")
  return end > 0 ? path.slice(0, end) : ""
}

/**
 * One crumb per segment, each carrying the folder it opens. Collapsed rows
 * are spelled out again here: a crumb the user cannot click past is a dead
 * end halfway up the path.
 */
export function folderCrumbs(folder: string): { name: string; path: string }[] {
  if (!folder) return []
  const segments = folder.split("/")
  return segments.map((name, index) => ({
    name,
    path: segments.slice(0, index + 1).join("/"),
  }))
}

function holdsFiles(outputs: TurnOutput[], folder: string): boolean {
  return outputs.some((output) =>
    output.artifact.relativePath.startsWith(`${folder}/`)
  )
}

/** The folder segments every one of these paths starts with. */
function sharedFolderPath(paths: string[]): string {
  let shared: string[] | undefined
  for (const path of paths) {
    const segments = path.split("/").slice(0, -1)
    if (!shared) {
      shared = segments
      continue
    }
    let kept = 0
    while (kept < shared.length && shared[kept] === segments[kept]) kept += 1
    shared = shared.slice(0, kept)
    if (shared.length === 0) break
  }
  return shared?.join("/") ?? ""
}
