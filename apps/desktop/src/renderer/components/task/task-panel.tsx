import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react"
import ArrowLeftIcon from "lucide-react/dist/esm/icons/arrow-left"
import BotIcon from "lucide-react/dist/esm/icons/bot"
import ChevronRightIcon from "lucide-react/dist/esm/icons/chevron-right"
import DownloadIcon from "lucide-react/dist/esm/icons/download"
import ExternalLinkIcon from "lucide-react/dist/esm/icons/external-link"
import FilesIcon from "lucide-react/dist/esm/icons/files"
import FolderIcon from "lucide-react/dist/esm/icons/folder"
import FolderOpenIcon from "lucide-react/dist/esm/icons/folder-open"
import GitBranchIcon from "lucide-react/dist/esm/icons/git-branch"
import GlobeIcon from "lucide-react/dist/esm/icons/globe"
import MessagesSquareIcon from "lucide-react/dist/esm/icons/messages-square"
import {
  isActivityBlocked,
  type Activity,
  type Artifact,
  type BrowserElementContext,
  type Thread,
  type TurnOutput,
} from "@deskto/protocol"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { z } from "zod"

import { useLocalStorage } from "../../lib/use-local-storage.js"
import { describedErrorSchema } from "../../runtime/describe-error.js"
import { useRuntimeClient } from "../../runtime/runtime-client-context.js"
import {
  useRuntimeQuery,
  type QueryState,
} from "../../runtime/use-runtime-query.js"
import { useSurface, useTaskPanelState } from "../../surface/surface-context.js"
import { InlineError } from "../inline-error.js"
import { ActivityPanel } from "./activity-panel.js"
import { BrowserPanel } from "./browser-panel.js"
import { summarizeActivities } from "./activity-tree.js"
import {
  ArtifactEditorSlot,
  ArtifactIcon,
  ArtifactPreviewBody,
  isEditableArtifactKind,
} from "./artifact-views.js"
import {
  folderCrumbs,
  listFolder,
  parentFolder,
  resolveFolder,
} from "./file-listing.js"
import { PreviewFailure, PreviewLoading } from "./preview-states.js"
import { ResultPreviewBoundary } from "./result-preview-boundary.js"
import { SideChatPanel } from "./side-chat-panel.js"
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

/** One task's files and activity beside its conversation. */
export function TaskPanel({
  threadId,
  activities,
  childThreads,
  sideThread,
  parentTitle,
  projectPath,
  focusRequest,
  onFocusHandled,
  files,
  browserContexts,
  onSelectBrowserElement,
  onOpenSide,
  onDiscardSide,
}: {
  threadId: string
  activities: Activity[]
  childThreads: Thread[]
  sideThread?: Thread
  parentTitle?: string
  projectPath?: string
  focusRequest?: number
  onFocusHandled?: () => void
  files: QueryState<TurnOutput[]>
  browserContexts: readonly BrowserElementContext[]
  onSelectBrowserElement: (context: BrowserElementContext) => void
  onOpenSide: () => void
  onDiscardSide: () => Promise<void>
}) {
  const surface = useSurface()
  const outputs = files.status === "ready" ? files.data : undefined
  const panel = useTaskPanelState(threadId)
  const byId = useMemo(
    () => new Map(outputs?.map((output) => [output.artifact.id, output])),
    [outputs]
  )
  const active = panel.selectedArtifactId
    ? byId.get(panel.selectedArtifactId)
    : undefined
  // Where the panel is standing: the folder holding the open file, or the one
  // the user browsed to — with a folder the task has since emptied giving way
  // to its nearest surviving ancestor, so the list never opens on nothing.
  // One rule, so leaving a file and refreshing the list agree on the answer.
  const folder = active
    ? parentFolder(active.artifact.relativePath)
    : outputs
      ? resolveFolder(outputs, panel.folderPath)
      : panel.folderPath
  useEffect(() => {
    if (outputs) surface.files.keepFolder(threadId, folder)
  }, [outputs, surface.files, threadId, folder])
  const activitySummary = useMemo(
    () => summarizeActivities(activities),
    [activities]
  )
  const runningAgents =
    activitySummary.working +
    childThreads.filter(
      (thread) =>
        thread.status === "running" || thread.status === "waiting-approval"
    ).length
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

  // The panel sits a step above the canvas the conversation is on. A hairline
  // alone could not tell two full-height columns apart when both were the
  // same near-black.
  return (
    <aside
      ref={asideRef}
      style={{
        width: effectivePanelWidth,
        minWidth: minimumTaskPanelWidth,
        maxWidth: `calc(100% - ${minimumConversationWidth}px)`,
      }}
      className="glass-panel relative flex h-full shrink-0 flex-col border-l border-border"
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
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <FilesTab
            active={panel.surface === "files"}
            count={outputs?.length ?? 0}
            onSelect={() => surface.files.openPanel(threadId)}
          />
          <ActivityTab
            active={panel.surface === "activities"}
            runningAgents={runningAgents}
            onSelect={() => surface.activities.open(threadId)}
          />
          <BrowserTab
            active={panel.surface === "browser"}
            onSelect={() => surface.browser.open(threadId)}
          />
          <SideTab
            active={panel.surface === "side"}
            running={sideThread ? isActivityBlocked(sideThread) : false}
            onSelect={onOpenSide}
          />
        </div>
        <div className="flex shrink-0 items-center">
          
        </div>
      </div>

      {panel.surface === "side" ? (
        sideThread ? (
          <SideChatPanel
            thread={sideThread}
            parentTitle={parentTitle}
            {...(projectPath ? { projectPath } : {})}
            {...(focusRequest ? { focusRequest } : {})}
            {...(onFocusHandled ? { onFocusHandled } : {})}
            onDiscard={onDiscardSide}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
            <GitBranchIcon aria-hidden className="size-4 motion-safe:animate-pulse" />
            Starting side chat…
          </div>
        )
      ) : panel.surface === "browser" ? (
        <BrowserPanel
          threadId={threadId}
          selectedElementCount={browserContexts.length}
          onSelectElement={onSelectBrowserElement}
        />
      ) : panel.surface === "activities" ? (
        <ActivityPanel
          summary={activitySummary}
          childThreads={childThreads}
          onOpenThread={surface.navigation.openTask}
          onOpenFiles={() => surface.files.overview(threadId)}
        />
      ) : files.status === "error" ? (
        <div className="p-3">
          <InlineError message={files.message} />
        </div>
      ) : active ? (
        <ResultPreviewBoundary key={active.artifact.id}>
          <FilePreview
            key={active.artifact.id}
            threadId={threadId}
            output={active}
            // Back to where the file lives, not to the top: a file opened
            // from the conversation lands the user in its folder.
            onBack={() => surface.files.openFolder(threadId, folder)}
          />
        </ResultPreviewBoundary>
      ) : (
        <FilesOverview
          loading={files.status !== "ready"}
          outputs={outputs ?? []}
          folder={folder}
          onOpenFolder={(path) => surface.files.openFolder(threadId, path)}
          onSelect={(artifactId) => surface.files.open(threadId, artifactId)}
        />
      )}
    </aside>
  )
}

function SideTab({
  active,
  running,
  onSelect,
}: {
  active: boolean
  running: boolean
  onSelect: () => void
}) {
  return (
    <PanelTab
      active={active}
      onSelect={onSelect}
      title="Ask a side question with the current context"
    >
      <MessagesSquareIcon aria-hidden className="size-3.5 shrink-0" />
      <span>Side</span>
      {running ? (
        <span
          role="img"
          className="size-1.5 rounded-full bg-foreground/60 motion-safe:animate-pulse"
          aria-label="Side chat is working"
        />
      ) : null}
    </PanelTab>
  )
}

function BrowserTab({
  active,
  onSelect,
}: {
  active: boolean
  onSelect: () => void
}) {
  return (
    <PanelTab
      active={active}
      onSelect={onSelect}
      title="Browser shared with the agent"
    >
      <GlobeIcon aria-hidden className="size-3.5 shrink-0" />
      <span>Browser</span>
    </PanelTab>
  )
}

function FilesTab({
  active,
  count,
  onSelect,
}: {
  active: boolean
  count: number
  onSelect: () => void
}) {
  return (
    <PanelTab active={active} onSelect={onSelect}>
      <FilesIcon aria-hidden className="size-3.5 shrink-0" />
      <span>Files</span>
      {count > 0 ? (
        <span className="tabular-nums opacity-60">{count}</span>
      ) : null}
    </PanelTab>
  )
}

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
    <PanelTab
      active={active}
      onSelect={onSelect}
      title="This task's plan and agents"
    >
      <BotIcon aria-hidden className="size-3.5 shrink-0" />
      <span>Activities</span>
      {runningAgents > 0 ? (
        <span
          role="img"
          className="size-1.5 rounded-full bg-foreground/60 [animation-duration:1.4s] motion-safe:animate-pulse"
          aria-label={`${runningAgents} agents running`}
        />
      ) : null}
    </PanelTab>
  )
}

function PanelTab({
  active,
  onSelect,
  title,
  children,
}: {
  active: boolean
  onSelect: () => void
  title?: string
  children: ReactNode
}) {
  // The selected tab is the one filled pill in the header, so the fill has to
  // survive the pointer: a hover that changed it would read as a second state.
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-pressed={active}
      onClick={onSelect}
      title={title}
      className={cn(
        "gap-1.5",
        active
          ? "bevel bg-fill-row-selected text-foreground hover:bg-fill-row-selected"
          : "text-muted-foreground"
      )}
    >
      {children}
    </Button>
  )
}

function FilesOverview({
  loading,
  outputs,
  folder,
  onOpenFolder,
  onSelect,
}: {
  loading: boolean
  outputs: TurnOutput[]
  folder: string
  onOpenFolder: (folderPath: string) => void
  onSelect: (artifactId: string) => void
}) {
  if (loading || outputs.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
        {loading
          ? "Loading files…"
          : "Files created or changed by this task will appear here."}
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mb-3 px-1">
        <FolderCrumbs folder={folder} onOpenFolder={onOpenFolder} />
        <p className="mt-1 text-xs text-muted-foreground">
          Created or changed during this task
        </p>
      </div>
      <ul className="flex flex-col gap-1">
        {listFolder(outputs, folder).map((row) =>
          row.kind === "folder" ? (
            <li key={`folder:${row.path}`}>
              <FileTreeRowButton
                title={row.path}
                onClick={() => onOpenFolder(row.path)}
                icon={<FolderIcon className="size-4 text-muted-foreground" />}
                name={row.name}
                meta={row.fileCount === 1 ? "1 file" : `${row.fileCount} files`}
                opensFolder
              />
            </li>
          ) : (
            <li key={row.output.artifact.id}>
              <FileTreeRowButton
                title={row.output.artifact.relativePath}
                onClick={() => onSelect(row.output.artifact.id)}
                icon={
                  <ArtifactIcon
                    kind={row.output.artifact.previewKind}
                    className="size-4 text-muted-foreground"
                  />
                }
                name={row.output.artifact.name}
                meta={describeFile(row.output.artifact, row.output.producedAt)}
              />
            </li>
          )
        )}
      </ul>
    </div>
  )
}

function FileTreeRowButton({
  title,
  onClick,
  icon,
  name,
  meta,
  opensFolder = false,
}: {
  title: string
  onClick: () => void
  icon: ReactNode
  name: string
  meta: string
  /** Whether the row goes further into the list rather than opening a file. */
  opensFolder?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex w-full items-center gap-3 rounded-row px-3 py-2.5 text-left transition-colors duration-150 ease-out outline-none hover:bg-fill-chip focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* Outlined rather than filled: the row fills on hover, and a filled
          tile would vanish into it. */}
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md ring-1 ring-border/70">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{name}</span>
        {/* Same mono line the preview header carries, so a file reads the
            same in the list and once it is open. */}
        <span className="mt-0.5 block truncate eyebrow text-muted-foreground">
          {meta}
        </span>
      </span>
      {/* A folder row and a file row are otherwise the same object; the
          chevron is what says one of them goes somewhere. */}
      {opensFolder ? (
        <ChevronRightIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
      ) : null}
    </button>
  )
}

/**
 * The path back out. Every ancestor is a target, so a user who opened four
 * folders deep leaves in one click rather than four.
 */
function FolderCrumbs({
  folder,
  onOpenFolder,
}: {
  folder: string
  onOpenFolder: (folderPath: string) => void
}) {
  const crumbs = folderCrumbs(folder)
  return (
    <h2 className="flex flex-wrap items-center gap-x-1 eyebrow text-muted-foreground">
      {crumbs.length === 0 ? (
        "Files"
      ) : (
        <button
          type="button"
          onClick={() => onOpenFolder("")}
          className="rounded-sm transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          Files
        </button>
      )}
      {crumbs.map((crumb, index) => (
        <span key={crumb.path} className="flex items-center gap-x-1">
          <span aria-hidden className="opacity-50">
            /
          </span>
          {index === crumbs.length - 1 ? (
            <span className="text-foreground">{crumb.name}</span>
          ) : (
            <button
              type="button"
              onClick={() => onOpenFolder(crumb.path)}
              className="rounded-sm transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {crumb.name}
            </button>
          )}
        </span>
      ))}
    </h2>
  )
}

/**
 * The version an editing session started from. Editing pins the content it
 * loaded so an agent writing the same file mid-edit cannot swap the text
 * under the user; the preview says so instead and offers to reload.
 */
type EditSession = {
  version: string
  content: string
}

/** One artifact's preview, editor, and file actions. Shared with the side
    chat, which previews its own outputs in place of the conversation. */
export function FilePreview({
  threadId,
  output,
  onBack,
}: {
  threadId: string
  output: TurnOutput
  onBack: () => void
}) {
  const client = useRuntimeClient()
  const surface = useSurface()
  const artifact = output.artifact
  const [session, setSession] = useState<EditSession | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const version = artifact.updatedAt
  const loadPreview = useMemo(() => {
    // A new version replaces this loader, so an agent edit landing while the
    // preview is open refreshes it instead of showing stale content.
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
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Back to files"
          title="Back to files"
          onClick={onBack}
        >
          <ArrowLeftIcon />
        </Button>
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-sm font-medium"
            title={artifact.relativePath}
          >
            {artifact.name}
          </p>
          {/* Size, age, folder — machine facts about the file, so they take
              the mono voice and sit under its human-readable name. */}
          <p className="truncate eyebrow text-muted-foreground">
            {describeFileWithFolder(artifact, output.producedAt)}
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
              await surface.files.saveCopy(fileAction, artifact.name)
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
          onClick={() => void runAction(() => surface.files.reveal(fileAction))}
        >
          <FolderOpenIcon />
        </Button>
        {artifact.openable ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Open in its own application"
            title="Open in its own application"
            onClick={() =>
              void runAction(() => surface.files.openExternally(fileAction))
            }
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
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-fill-card px-3 py-2">
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
function describeFileWithFolder(
  artifact: Artifact,
  producedAt: string
): string {
  const folder = parentFolder(artifact.relativePath)
  return [describeFile(artifact, producedAt), folder]
    .filter(Boolean)
    .join(" · ")
}

/**
 * The same line without the folder, for a list that is already standing in
 * that folder.
 */
function describeFile(artifact: Artifact, producedAt: string): string {
  return `${formatBytes(artifact.sizeBytes)} · changed ${describeAge(producedAt)}`
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
