import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react"
import BotIcon from "lucide-react/dist/esm/icons/bot"
import DownloadIcon from "lucide-react/dist/esm/icons/download"
import ExternalLinkIcon from "lucide-react/dist/esm/icons/external-link"
import FolderOpenIcon from "lucide-react/dist/esm/icons/folder-open"
import PlusIcon from "lucide-react/dist/esm/icons/plus"
import XIcon from "lucide-react/dist/esm/icons/x"
import type { Activity, Artifact, TurnOutput } from "@deskto/protocol"

import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@workspace/ui/lib/utils"
import { z } from "zod"

import {
  openResultFile,
  revealResultFile,
  saveResultCopy,
} from "../../lib/desktop.js"
import { useLocalStorage } from "../../lib/use-local-storage.js"
import { describedErrorSchema } from "../../runtime/describe-error.js"
import { useRuntimeClient } from "../../runtime/runtime-client-context.js"
import {
  useRuntimeQuery,
  type QueryState,
} from "../../runtime/use-runtime-query.js"
import { InlineError } from "../inline-error.js"
import { ActivityPanel } from "./activity-panel.js"
import { summarizeActivities } from "./activity-tree.js"
import {
  ArtifactEditorSlot,
  ArtifactIcon,
  ArtifactPreviewBody,
  isEditableArtifactKind,
} from "./artifact-views.js"
import {
  activityTabId,
  closeResultTab,
  openActivityTab,
  openResultTab,
  usePanelTabs,
} from "./panel-tabs.js"
import { PreviewFailure, PreviewLoading } from "./preview-states.js"
import { ResultPreviewBoundary } from "./result-preview-boundary.js"
import {
  clampTaskPanelWidth,
  defaultTaskPanelWidth,
  maximumTaskPanelWidth,
  maximumTaskPanelWidthForContainer,
  minimumConversationWidth,
  minimumTaskPanelWidth,
} from "./task-panel-size.js"

const taskPanelWidthSchema = z
  .number()
  .int()
  .min(minimumTaskPanelWidth)
  .max(maximumTaskPanelWidth)

/**
 * One task's work beside its conversation. Activity leads and never closes:
 * the plan an agent is working to and the agents it spawned are always worth
 * a place, even before the task has produced a file. Every other tab is a
 * real file in the Project folder, which the panel previews, edits for the
 * formats that can be written back safely, and otherwise hands to the
 * application that owns it.
 */
export function TaskPanel({
  threadId,
  activities,
  results,
  onClose,
}: {
  threadId: string
  activities: Activity[]
  results: QueryState<TurnOutput[]>
  onClose: () => void
}) {
  const outputs = results.status === "ready" ? results.data : undefined
  const tabs = usePanelTabs(threadId)
  const byId = useMemo(
    () => new Map(outputs?.map((output) => [output.artifact.id, output])),
    [outputs]
  )
  const onActivity = tabs.activeId === activityTabId
  const active = onActivity ? undefined : byId.get(tabs.activeId)
  const activitySummary = useMemo(
    () => summarizeActivities(activities),
    [activities]
  )
  const runningAgents = activitySummary.working
  const openNewestResult = useCallback(() => {
    const newest = outputs?.[0]?.artifact.id
    if (newest) openResultTab(threadId, newest)
  }, [outputs, threadId])
  const [panelWidth, setPanelWidth] = useLocalStorage(
    // The key still says results: the width a user dragged is theirs, and a
    // rename is no reason to hand it back.
    "deskto.results-panel-width:v1",
    defaultTaskPanelWidth,
    taskPanelWidthSchema
  )
  const [containerWidth, setContainerWidth] = useState(
    maximumTaskPanelWidth + minimumConversationWidth
  )
  const asideRef = useRef<HTMLElement>(null)
  const separatorRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startWidth: number
    width: number
  } | null>(null)

  useLayoutEffect(() => {
    const container = asideRef.current?.parentElement
    if (!container) return
    const updateContainerWidth = () => setContainerWidth(container.clientWidth)
    updateContainerWidth()
    const observer = new ResizeObserver(updateContainerWidth)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const effectiveMaximumWidth =
    maximumTaskPanelWidthForContainer(containerWidth)
  const effectivePanelWidth = clampTaskPanelWidth(panelWidth, containerWidth)

  const resizeTo = useCallback((width: number) => {
    const aside = asideRef.current
    const containerWidth =
      aside?.parentElement?.clientWidth ?? window.innerWidth
    const next = clampTaskPanelWidth(width, containerWidth)
    if (aside) aside.style.width = `${next}px`
    separatorRef.current?.setAttribute(
      "aria-valuemax",
      String(maximumTaskPanelWidthForContainer(containerWidth))
    )
    separatorRef.current?.setAttribute("aria-valuenow", String(next))
    return next
  }, [])

  const handleResizeStart = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const aside = asideRef.current
      if (!aside) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      const width = Math.round(aside.getBoundingClientRect().width)
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: width,
        width,
      }
    },
    []
  )

  const handleResizeMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      drag.width = resizeTo(drag.startWidth + drag.startX - event.clientX)
    },
    [resizeTo]
  )

  const handleResizeEnd = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      dragRef.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      setPanelWidth(drag.width)
    },
    [setPanelWidth]
  )

  const handleResizeKey = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      let next: number | undefined
      const width =
        asideRef.current?.getBoundingClientRect().width ?? panelWidth
      const step = event.shiftKey ? 64 : 16
      if (event.key === "ArrowLeft") next = width + step
      if (event.key === "ArrowRight") next = width - step
      if (event.key === "Home") next = minimumTaskPanelWidth
      if (event.key === "End") next = maximumTaskPanelWidth
      if (next === undefined) return
      event.preventDefault()
      setPanelWidth(resizeTo(next))
    },
    [panelWidth, resizeTo, setPanelWidth]
  )

  return (
    <aside
      ref={asideRef}
      style={{
        width: effectivePanelWidth,
        minWidth: minimumTaskPanelWidth,
        maxWidth: `calc(100% - ${minimumConversationWidth}px)`,
      }}
      className="relative flex h-full shrink-0 flex-col border-l border-border bg-background"
    >
      <div
        ref={separatorRef}
        role="separator"
        aria-label="Resize task panel"
        aria-orientation="vertical"
        aria-valuemin={minimumTaskPanelWidth}
        aria-valuemax={effectiveMaximumWidth}
        aria-valuenow={effectivePanelWidth}
        tabIndex={0}
        title="Drag to resize the panel"
        onDoubleClick={() => setPanelWidth(resizeTo(defaultTaskPanelWidth))}
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
        onKeyDown={handleResizeKey}
        className="group/resize absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize touch-none outline-none"
      >
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover/resize:bg-ring group-focus-visible/resize:bg-ring" />
      </div>
      <div className="flex h-10 shrink-0 items-stretch gap-1 border-b border-border pr-2 pl-1">
        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          <ActivityTab
            active={onActivity}
            runningAgents={runningAgents}
            onSelect={() => openActivityTab(threadId)}
          />
          {tabs.open.map((id) => {
            const output = byId.get(id)
            return output ? (
              <ResultTab
                key={id}
                artifact={output.artifact}
                active={id === tabs.activeId}
                onSelect={() => openResultTab(threadId, id)}
                onClose={() => closeResultTab(threadId, id)}
              />
            ) : null
          })}
          <OpenResultMenu
            outputs={outputs ?? []}
            onSelect={(id) => openResultTab(threadId, id)}
          />
        </div>
        <div className="flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Close the panel"
          >
            <XIcon />
          </Button>
        </div>
      </div>

      {onActivity ? (
        <ActivityPanel
          summary={activitySummary}
          onOpenResults={openNewestResult}
        />
      ) : results.status === "error" ? (
        <div className="p-3">
          <InlineError message={results.message} />
        </div>
      ) : active ? (
        <ResultPreviewBoundary key={active.artifact.id}>
          <ResultTabContent
            key={active.artifact.id}
            threadId={threadId}
            output={active}
          />
        </ResultPreviewBoundary>
      ) : (
        <EmptyResults
          loading={results.status !== "ready"}
          hasResults={(outputs?.length ?? 0) > 0}
        />
      )}
    </aside>
  )
}

/**
 * The fixture at the head of the strip. It carries no close button — there is
 * nothing to put back once a task's work is dismissed — and badges the agents
 * still running so the panel says so while a file is in front of it.
 */
function ActivityTab({
  active,
  runningAgents,
  onSelect,
}: {
  active: boolean
  runningAgents: number
  onSelect: () => void
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center self-center rounded-md px-2 transition-colors",
        active ? "bg-muted" : "hover:bg-muted/50"
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        title="This task's plan and agents"
        className="flex h-7 items-center gap-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <BotIcon
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground"
        />
        <span className={active ? "text-foreground" : "text-muted-foreground"}>
          Activity
        </span>
        {runningAgents > 0 ? (
          <span
            role="img"
            className="size-1.5 rounded-full bg-foreground/60 [animation-duration:1.4s] motion-safe:animate-pulse"
            aria-label={`${runningAgents} agents running`}
          />
        ) : null}
      </button>
    </div>
  )
}

function EmptyResults({
  loading,
  hasResults,
}: {
  loading: boolean
  hasResults: boolean
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
      {loading
        ? "Loading results…"
        : hasResults
          ? "Choose a file to open it here."
          : "Files created or changed by this task will appear here."}
    </div>
  )
}

function ResultTab({
  artifact,
  active,
  onSelect,
  onClose,
}: {
  artifact: Artifact
  active: boolean
  onSelect: () => void
  onClose: () => void
}) {
  return (
    <div
      className={cn(
        "group/tab flex min-w-0 shrink items-center gap-1 self-center rounded-md pr-1 pl-2 transition-colors",
        active ? "bg-muted" : "hover:bg-muted/50"
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        title={artifact.relativePath}
        className="flex h-7 min-w-0 items-center gap-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <ArtifactIcon
          kind={artifact.previewKind}
          className="size-3.5 shrink-0 text-muted-foreground"
        />
        <span
          className={cn(
            "max-w-36 truncate",
            active ? "text-foreground" : "text-muted-foreground"
          )}
        >
          {artifact.name}
        </span>
      </button>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onClose}
        aria-label={`Close ${artifact.name}`}
        className="shrink-0 opacity-0 transition-opacity group-hover/tab:opacity-100 focus-visible:opacity-100"
      >
        <XIcon />
      </Button>
    </div>
  )
}

/** Every result of the task, so a file closed earlier can come back. */
function OpenResultMenu({
  outputs,
  onSelect,
}: {
  outputs: TurnOutput[]
  onSelect: (artifactId: string) => void
}) {
  if (outputs.length === 0) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="self-center"
            aria-label="Open a result"
          />
        }
      >
        <PlusIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        {outputs.map(({ artifact }) => (
          <DropdownMenuItem
            key={artifact.id}
            onClick={() => onSelect(artifact.id)}
          >
            <ArtifactIcon
              kind={artifact.previewKind}
              className="size-4 shrink-0 text-muted-foreground"
            />
            <span className="min-w-0 flex-1 truncate">{artifact.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatBytes(artifact.sizeBytes)}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The version an editing session started from. Editing pins the content it
 * loaded so an agent writing the same file mid-edit cannot swap the text
 * under the user; the tab says so instead and offers to reload.
 */
type EditSession = {
  version: string
  content: string
}

function ResultTabContent({
  threadId,
  output,
}: {
  threadId: string
  output: TurnOutput
}) {
  const client = useRuntimeClient()
  const artifact = output.artifact
  const [session, setSession] = useState<EditSession | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const version = artifact.updatedAt
  const loadPreview = useMemo(() => {
    // A new version replaces this loader, so an agent edit landing while the
    // tab is open refreshes the preview instead of showing stale content.
    void version
    return () => client.previewArtifact(threadId, artifact.id)
  }, [client, threadId, artifact.id, version])
  const preview = useRuntimeQuery(loadPreview)

  const runAction = useCallback(async (action: () => Promise<void>) => {
    setActionError(null)
    try {
      await action()
    } catch (error) {
      setActionError(describedErrorSchema.parse(error))
    }
  }, [])

  const content =
    preview.state.status === "ready" && "content" in preview.state.data
      ? preview.state.data.content
      : undefined

  const handleSave = useCallback(
    (next: string) =>
      runAction(async () => {
        setSaving(true)
        try {
          const saved = await client.writeArtifact(
            threadId,
            artifact.id,
            next,
            // The pinned version, not the latest: saving against a file that
            // moved on is exactly what the Runtime must refuse.
            session?.version ?? artifact.updatedAt
          )
          setSession({ version: saved.updatedAt, content: next })
          setDirty(false)
        } finally {
          setSaving(false)
        }
      }),
    [runAction, client, threadId, artifact.id, artifact.updatedAt, session]
  )

  const canEdit =
    isEditableArtifactKind(artifact.previewKind) && content !== undefined
  const stale = session !== null && session.version < artifact.updatedAt
  const fileAction = { threadId, artifactId: artifact.id }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-sm font-medium"
            title={artifact.relativePath}
          >
            {artifact.name}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {describeResult(artifact, output.producedAt)}
          </p>
        </div>
        {canEdit ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={dirty}
            title={
              dirty
                ? "Save or discard your changes first"
                : session
                  ? "Stop editing"
                  : "Edit this file"
            }
            onClick={() =>
              setSession(
                session ? null : { version: artifact.updatedAt, content }
              )
            }
          >
            {session ? "Done" : "Edit"}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Save a copy"
          title="Save a copy"
          onClick={() =>
            void runAction(async () => {
              await saveResultCopy(fileAction, artifact.name)
            })
          }
        >
          <DownloadIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Show in folder"
          title="Show in folder"
          onClick={() => void runAction(() => revealResultFile(fileAction))}
        >
          <FolderOpenIcon />
        </Button>
        {artifact.openable ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Open in its own application"
            title="Open in its own application"
            onClick={() => void runAction(() => openResultFile(fileAction))}
          >
            <ExternalLinkIcon />
          </Button>
        ) : null}
      </header>

      {actionError ? (
        <div className="shrink-0 p-3">
          <InlineError message={actionError} />
        </div>
      ) : null}

      {stale ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-3 py-2">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            This file changed on disk while you were editing. Saving now will be
            refused.
          </p>
          <Button
            variant="outline"
            size="xs"
            onClick={() =>
              setSession(
                content === undefined
                  ? null
                  : { version: artifact.updatedAt, content }
              )
            }
          >
            Reload
          </Button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col">
        {preview.state.status === "error" ? (
          <PreviewFailure message={preview.state.message} />
        ) : preview.state.status !== "ready" ? (
          <PreviewLoading label="Loading preview…" />
        ) : session ? (
          // Keyed by the pinned version: a save, or an explicit reload, is
          // what restarts the editor — never a refresh underneath it.
          <ArtifactEditorSlot
            key={session.version}
            kind={artifact.previewKind}
            content={session.content}
            saving={saving}
            onSave={handleSave}
            onDirtyChange={setDirty}
          />
        ) : (
          <ArtifactPreviewBody preview={preview.state.data} />
        )}
      </div>
    </div>
  )
}

/**
 * Size, when the task last wrote it, and the folder when there is one. A file
 * at the top of the Project would otherwise read its own name back twice.
 */
function describeResult(artifact: Artifact, producedAt: string): string {
  const end = artifact.relativePath.lastIndexOf("/")
  return [
    formatBytes(artifact.sizeBytes),
    `changed ${describeAge(producedAt)}`,
    end > 0 ? artifact.relativePath.slice(0, end) : undefined,
  ]
    .filter(Boolean)
    .join(" · ")
}

function describeAge(timestamp: string): string {
  const minutes = Math.floor((Date.now() - Date.parse(timestamp)) / 60_000)
  if (!Number.isFinite(minutes) || minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.floor(hours / 24)} d ago`
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}
