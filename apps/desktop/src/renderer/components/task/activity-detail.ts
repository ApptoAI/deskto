/**
 * What a tool call's detail says at rest. The Harness reports the real
 * thing — the whole command, the absolute path — and the transcript keeps
 * it: expanding the row still shows the text verbatim, and file chips
 * already carry their own name.
 *
 * The resting line is shorter because the feed answers "what is happening"
 * before it answers "exactly how". A row reading `Run ls` beside a row
 * reading `Run ls -la /home/someone/.config/@deskto/...` is the same fact
 * with less to wade through, and the fuller answer is one click away.
 */

/** A path, roughly: separators and no argument-shaped whitespace. */
function looksLikePath(detail: string): boolean {
  return detail.includes("/") && !/\s/.test(detail)
}

/**
 * Trims a path against the project it belongs to, then to its last two
 * segments. Two rather than one because a bare `index.ts` names a file in
 * every folder, while `renderer/index.ts` names a place.
 */
export function shortenPath(path: string, projectPath?: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "")
  const root = projectPath?.replaceAll("\\", "/").replace(/\/+$/, "")
  const relative =
    root && normalized.startsWith(`${root}/`)
      ? normalized.slice(root.length + 1)
      : normalized
  const segments = relative.split("/").filter((segment) => segment !== "")
  if (segments.length <= 2) return relative
  return segments.slice(-2).join("/")
}

/**
 * A command down to what it runs and the first thing it runs on. Flags are
 * part of the "exactly how" the expanded row is for.
 */
export function shortenCommand(command: string): string {
  const collapsed = command.trim().replace(/\s+/g, " ")
  // A pipeline or a chain is not one command, and naming the first step
  // would misreport the rest, so it keeps the whole leading segment.
  const firstClause = collapsed.split(/\s*(?:&&|\|\||[|;])\s*/)[0] ?? collapsed
  const tokens = firstClause.split(" ")
  const head = tokens.slice(0, 2).join(" ")
  const truncated = head.length < collapsed.length
  return truncated ? `${head}…` : collapsed
}

export function shortenActivityDetail(
  detail: string,
  projectPath?: string
): string {
  if (looksLikePath(detail)) return shortenPath(detail, projectPath)
  if (detail.includes(" ")) return shortenCommand(detail)
  return detail
}
