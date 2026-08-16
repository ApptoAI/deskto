import { useState } from "react"
import type { ReactNode } from "react"
import BotIcon from "lucide-react/dist/esm/icons/bot"
import ChevronDownIcon from "lucide-react/dist/esm/icons/chevron-down"
import CircleCheckIcon from "lucide-react/dist/esm/icons/circle-check"
import CircleXIcon from "lucide-react/dist/esm/icons/circle-x"
import FilePenIcon from "lucide-react/dist/esm/icons/file-pen"
import GlobeIcon from "lucide-react/dist/esm/icons/globe"
import LoaderCircleIcon from "lucide-react/dist/esm/icons/loader-circle"
import SearchIcon from "lucide-react/dist/esm/icons/search"
import TerminalIcon from "lucide-react/dist/esm/icons/terminal"
import WrenchIcon from "lucide-react/dist/esm/icons/wrench"
import type { Activity } from "@deskto/protocol"

import { cn } from "@workspace/ui/lib/utils"

import { ArtifactIcon } from "./artifact-views.js"
import { elapsedBetween, formatElapsed, useElapsed } from "./elapsed.js"
import { useResultAt } from "./results-context.js"

/**
 * The rows a Turn's work is drawn with, shared by the conversation and the
 * task panel. One vocabulary in both places: a tool call folded into a
 * settled Turn and the same call read inside a subagent are the same row.
 */

export function Collapse({
  open,
  className,
  children,
}: {
  open: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-300 ease-(--ease-out-quart) motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      )}
    >
      <div className={cn("min-h-0 overflow-hidden", className)} inert={!open}>
        {children}
      </div>
    </div>
  )
}

export type Icon = typeof TerminalIcon

const toolIcons = new Map<string, Icon>([
  ["command", TerminalIcon],
  ["search", SearchIcon],
  ["web", GlobeIcon],
  ["mcp", WrenchIcon],
])

export function activityIcon(activity: Activity): Icon | undefined {
  const payload = activity.payload
  if (!payload) return undefined
  if (payload.kind === "file-change") return FilePenIcon
  if (payload.kind === "subagent") return BotIcon
  if (payload.kind !== "tool") return undefined
  return toolIcons.get(payload.tool)
}

/**
 * One tool call as a compact row: kind icon, name, and the detail in an
 * inline chip. Rows with a truncatable detail expand — the icon crossfades
 * to a chevron on hover — to show the full text. File changes render their
 * files as diff chips instead.
 */
export function ActivityLine({
  activity,
  icon,
}: {
  activity: Activity
  // Resolved by the caller rather than here: a component picked inside its own
  // render is a component recreated on every render.
  icon?: Icon | undefined
}) {
  const [open, setOpen] = useState(false)
  const payload = activity.payload
  const files = payload?.kind === "file-change" ? payload.files : []
  const mono =
    payload?.kind === "file-change" ||
    (payload?.kind === "tool" && payload.tool === "command")
  const running = activity.status === "running"
  const failed = activity.status === "failed"
  const expandable = Boolean(activity.detail) && files.length === 0
  const LeadIcon = running
    ? LoaderCircleIcon
    : failed
      ? CircleXIcon
      : (icon ?? CircleCheckIcon)

  const row = (
    <>
      <span className="relative flex size-4 shrink-0 items-center justify-center text-muted-foreground">
        <LeadIcon
          aria-hidden
          className={cn(
            "size-3.5",
            // Held still under reduced motion rather than swapped out: the
            // broken circle still separates a running row from a finished one.
            running && "[animation-duration:0.7s] motion-safe:animate-spin",
            failed && "text-destructive",
            expandable &&
              "transition-opacity duration-100 group-hover/row:opacity-0",
            expandable && open && "opacity-0"
          )}
        />
        {expandable ? (
          <ChevronDownIcon
            aria-hidden
            className={cn(
              "absolute size-3.5 opacity-0 transition-[opacity,rotate] duration-150 ease-(--ease-out-quart) group-hover/row:opacity-100",
              open ? "opacity-100" : "-rotate-90"
            )}
          />
        ) : null}
      </span>
      <span
        className={cn(
          "shrink-0 text-xs font-medium",
          failed ? "text-destructive" : "text-foreground"
        )}
      >
        {activity.name}
      </span>
      {files.length > 0 ? (
        <FileChips files={files} />
      ) : activity.detail ? (
        <span
          className={cn(
            "inline-flex h-5.5 min-w-0 items-center rounded-md bg-muted/60 px-1.5 text-[11px] text-muted-foreground ring-1 ring-border/40",
            mono && "font-mono"
          )}
        >
          <span className="truncate">{activity.detail}</span>
        </span>
      ) : null}
    </>
  )

  const rowClassName = cn(
    "group/row -mx-1.5 flex min-h-7 w-[calc(100%+12px)] min-w-0 items-center gap-2 rounded-md px-1.5 text-left transition-colors duration-100",
    expandable &&
      "cursor-pointer outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50"
  )

  if (!expandable) return <div className={rowClassName}>{row}</div>

  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={rowClassName}
      >
        {row}
      </button>
      <Collapse open={open}>
        <p
          className={cn(
            "mt-0.5 mb-1 ml-[7px] border-l border-border py-0.5 pl-3.5 text-[11px] leading-relaxed break-all whitespace-pre-wrap text-muted-foreground",
            mono && "font-mono"
          )}
        >
          {activity.detail}
        </p>
      </Collapse>
    </div>
  )
}

/** The status of one agent run: a spinning ring while it works, then a verdict. */
export function SubagentBadge({ status }: { status: Activity["status"] }) {
  if (status === "running") {
    return (
      <span className="relative flex size-5 shrink-0 items-center justify-center">
        {/* Reduced motion keeps the ring and its gap, just still: the shape
            already reads as pending next to the settled check and cross. */}
        <svg
          viewBox="0 0 20 20"
          aria-hidden
          className="absolute inset-0 [animation-duration:1.1s] motion-safe:animate-spin"
        >
          <circle
            cx="10"
            cy="10"
            r="8.5"
            fill="none"
            strokeWidth="2"
            className="stroke-border"
          />
          <circle
            cx="10"
            cy="10"
            r="8.5"
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="15 38.4"
            className="stroke-muted-foreground"
          />
        </svg>
        <BotIcon aria-hidden className="size-3 text-muted-foreground" />
      </span>
    )
  }
  return (
    <span
      key={status}
      aria-hidden
      className={cn(
        // The fade survives reduced motion the way `enter-rise` keeps its
        // own, but the scale-in does not: only the distance travelled is
        // what a motion-sensitive reader needs dropped.
        "flex size-5 shrink-0 items-center justify-center rounded-full text-white transition-[opacity,scale] duration-300 ease-(--ease-out-quart) starting:opacity-0 motion-safe:starting:scale-50",
        status === "completed"
          ? "bg-emerald-500 dark:bg-emerald-600"
          : "bg-destructive"
      )}
    >
      {status === "completed" ? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-3"
        >
          <path d="M20 6L9 17l-5-5" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
          className="size-2.5"
        >
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      )}
    </span>
  )
}

/** One timer implementation shared by both activity layouts. */
export function AgentElapsed({
  activity,
  className,
}: {
  activity: Activity
  className?: string
}) {
  if (activity.status === "running") {
    return <LiveElapsed since={activity.createdAt} className={className} />
  }
  const elapsed = elapsedBetween(activity.createdAt, activity.finishedAt)
  if (elapsed === undefined) return null
  return (
    <ElapsedText className={className}>{formatElapsed(elapsed)}</ElapsedText>
  )
}

function LiveElapsed({
  since,
  className,
}: {
  since: string
  className?: string
}) {
  return (
    <ElapsedText className={className}>
      {formatElapsed(useElapsed(since))}
    </ElapsedText>
  )
}

function ElapsedText({
  children,
  className,
}: {
  children: string
  className?: string
}) {
  return (
    <span
      className={cn(
        "shrink-0 font-mono text-[11px] text-muted-foreground/80 tabular-nums",
        className
      )}
    >
      {children}
    </span>
  )
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

/** The edits summarized as diff chips: file name plus added and removed
    line counts, wrapping as needed. A chip whose file was captured as a
    result opens it in the panel, so the conversation is a way into the work
    rather than a report about it. */
function FileChips({
  files,
}: {
  files: { path: string; additions?: number; deletions?: number }[]
}) {
  return (
    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1 py-0.5">
      {files.map((file) => (
        <FileChip key={file.path} file={file} />
      ))}
    </span>
  )
}

function FileChip({
  file,
}: {
  file: { path: string; additions?: number; deletions?: number }
}) {
  const result = useResultAt(file.path)
  const body = (
    <>
      <span className="min-w-0 truncate text-foreground/90">
        {fileName(file.path)}
      </span>
      {file.additions ? (
        <span className="shrink-0 text-emerald-600 tabular-nums dark:text-emerald-400">
          +{file.additions}
        </span>
      ) : null}
      {file.deletions ? (
        <span className="shrink-0 text-red-500 tabular-nums dark:text-red-400">
          −{file.deletions}
        </span>
      ) : null}
    </>
  )
  const className =
    "inline-flex h-5.5 max-w-full min-w-0 items-center gap-1.5 rounded-md bg-muted/60 px-1.5 font-mono text-[11px] ring-1 ring-border/40"

  if (!result) {
    return (
      <span title={file.path} className={className}>
        {body}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={result.open}
      title={`Open ${result.artifact.relativePath}`}
      className={cn(
        className,
        "cursor-pointer transition-colors outline-none hover:bg-muted hover:ring-border focus-visible:ring-2 focus-visible:ring-ring/50"
      )}
    >
      <ArtifactIcon
        kind={result.artifact.previewKind}
        className="size-3 shrink-0 text-muted-foreground"
      />
      {body}
    </button>
  )
}
