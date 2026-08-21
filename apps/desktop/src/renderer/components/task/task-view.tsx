import { useCallback, useEffect, useState } from "react"
import FolderOpenIcon from "lucide-react/dist/esm/icons/folder-open"
import PanelRightIcon from "lucide-react/dist/esm/icons/panel-right"
import { hasUnreadCompletion, threadCameBack } from "@deskto/client"
import type {
  BrowserElementContext,
  ExecutionProfile,
  Harness,
  Project,
  TurnOutput,
} from "@deskto/protocol"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { openFolder } from "../../lib/desktop.js"
import { describeHarnessBlock, findHarness } from "../../lib/harness.js"
import { describedErrorSchema } from "../../runtime/describe-error.js"
import { useRuntimeClient } from "../../runtime/runtime-client-context.js"
import { useRuntimeEvent } from "../../runtime/use-runtime-event.js"
import {
  useRuntimeQuery,
  type QueryState,
} from "../../runtime/use-runtime-query.js"
import { useThreadView } from "../../runtime/use-thread-view.js"
import { useSurface, useTaskPanelState } from "../../surface/surface-context.js"
import { Composer } from "../composer.js"
import { ContextUsageMeter } from "../context-usage-meter.js"
import { ExecutionProfileToolbar } from "../execution-profile/execution-profile-toolbar.js"
import { InlineError } from "../inline-error.js"
import { StatusPanel } from "../status-panel.js"
import { ActivityAside } from "./activity-aside.js"
import { ApprovalPanel } from "./approval-panel.js"
import { defaultArtifactOpenSurface } from "./artifact-open-target.js"
import { sharedFolder } from "./file-listing.js"
import { MessageStream } from "./message-stream.js"
import { FilesProvider } from "./files-context.js"
import { TaskPanel } from "./task-panel.js"
import { conversationMeasureClassName } from "./task-panel-size.js"

const noOutputs: TurnOutput[] = []

export function TaskView({
  threadId,
  harnesses,
  projects,
}: {
  threadId: string
  harnesses: QueryState<Harness[]>
  projects: Project[]
}) {
  const client = useRuntimeClient()
  const surface = useSurface()
  const { state, revalidate, replace } = useThreadView(threadId)
  const [taskActionError, setTaskActionError] = useState<string | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const panel = useTaskPanelState(threadId)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [browserContexts, setBrowserContexts] = useState<
    BrowserElementContext[]
  >([])

  useEffect(() => {
    let active = true
    const openBrowser = () => {
      surface.browser.open(threadId)
    }
    void surface.browser
      .state(threadId)
      .then((state) => {
        if (active && state.openRequested) openBrowser()
      })
      .catch(() => undefined)
    const unsubscribe = surface.browser.subscribe((event) => {
      if (event.type === "open-requested" && event.threadId === threadId) {
        openBrowser()
      }
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [surface.browser, threadId])

  useEffect(
    () => () => surface.panel.close(threadId),
    [surface.panel, threadId]
  )

  // Looking at the task clears its indicators (unread completion, "came
  // back" from Later). The stamp fires only when there is something to
  // clear: each visit write emits thread.changed and refetches every list,
  // so an unconditional stamp would double the reads on every task open.
  // This also covers a turn finishing while the user is already looking —
  // the refetched view arrives unread, the stamp clears it, and the next
  // refetch reads as seen, so it cannot loop.
  const needsVisitStamp =
    state.status === "ready" &&
    (hasUnreadCompletion(state.data.thread) ||
      threadCameBack(state.data.thread, { now: new Date().toISOString() }))
  useEffect(() => {
    if (needsVisitStamp) client.markThreadVisited(threadId).catch(() => {})
  }, [client, threadId, needsVisitStamp])

  // Current files feed the Files view and activity links. The complete output
  // history separately attaches files to the Turn that produced them.
  const loadFiles = useCallback(
    () => client.listFiles(threadId),
    [client, threadId]
  )
  const loadTurnOutputs = useCallback(
    () => client.listTurnOutputs(threadId),
    [client, threadId]
  )
  const files = useRuntimeQuery(loadFiles)
  const turnOutputs = useRuntimeQuery(loadTurnOutputs)
  const revalidateFiles = files.revalidate
  const revalidateTurnOutputs = turnOutputs.revalidate
  useRuntimeEvent(
    "artifact.changed",
    useCallback(
      (event) => {
        if (event.threadId !== threadId) return
        revalidateFiles()
        revalidateTurnOutputs()
      },
      [revalidateFiles, revalidateTurnOutputs, threadId]
    )
  )
  const fileList = files.state.status === "ready" ? files.state.data : undefined
  useEffect(() => {
    if (fileList) {
      surface.files.retainAvailable(
        threadId,
        fileList.map((output) => output.artifact.id)
      )
    }
  }, [fileList, surface.files, threadId])
  const outputHistory =
    turnOutputs.state.status === "ready" ? turnOutputs.state.data : noOutputs

  const openFile = useCallback(
    (artifactId: string) => {
      const artifact =
        fileList?.find((output) => output.artifact.id === artifactId)
          ?.artifact ??
        outputHistory.find((output) => output.artifact.id === artifactId)
          ?.artifact
      if (
        artifact &&
        defaultArtifactOpenSurface(artifact.previewKind) === "browser"
      ) {
        setTaskActionError(null)
        void surface.browser
          .openArtifact({ threadId, artifactId })
          .catch((error) =>
            setTaskActionError(describedErrorSchema.parse(error))
          )
        return
      }
      surface.files.open(threadId, artifactId)
    },
    [fileList, outputHistory, surface.browser, surface.files, threadId]
  )
  // An answer's overflow opens the folder its files share, so "Show all 5"
  // shows five files rather than the one folder row they hide behind.
  const openFiles = useCallback(
    (outputs: TurnOutput[]) => {
      surface.files.openFolder(threadId, sharedFolder(outputs))
    },
    [surface.files, threadId]
  )
  const openActivity = useCallback(() => {
    surface.activities.open(threadId)
  }, [surface.activities, threadId])

  if (state.status === "loading" || state.status === "idle") {
    return <StatusPanel title="Opening the task…" />
  }

  if (state.status === "error") {
    return (
      <StatusPanel
        title="This task could not be opened"
        description={state.message}
        tone="danger"
      >
        <Button variant="outline" onClick={revalidate}>
          Try again
        </Button>
      </StatusPanel>
    )
  }

  const {
    thread,
    childThreads,
    sideThread,
    messages,
    activities,
    pendingApproval,
  } = state.data
  const options = harnesses.status === "ready" ? harnesses.data : []
  // Resolved from the thread rather than the sidebar selection: in the
  // all-projects view the open task can belong to a different project.
  const project = projects.find((project) => project.id === thread.projectId)
  if (!project) {
    return (
      <StatusPanel
        title="This task's project is unavailable"
        description="Reload the project list and try opening the task again."
      />
    )
  }
  const projectPath = project.path
  const models = findHarness(options, thread.harnessId)?.models ?? []
  const active =
    thread.status === "running" || thread.status === "waiting-approval"

  const blockedReason = pendingApproval
    ? "Answer the request above before sending anything else."
    : describeHarnessBlock(harnesses, thread.harnessId)

  async function handleProfileChange(next: ExecutionProfile) {
    setProfileError(null)
    try {
      replace(await client.configureThread(thread.id, next))
    } catch (error) {
      setProfileError(describedErrorSchema.parse(error))
    }
  }

  async function handleOpenFolder(path: string) {
    setTaskActionError(null)
    try {
      await openFolder(path)
    } catch (error) {
      setTaskActionError(describedErrorSchema.parse(error))
    }
  }

  async function handleOpenSide() {
    setTaskActionError(null)
    if (sideThread) {
      surface.side.open(thread.id)
      return
    }
    try {
      replace(await client.createSideThread(thread.id))
      surface.side.open(thread.id)
    } catch (error) {
      setTaskActionError(describedErrorSchema.parse(error))
    }
  }

  async function handleDiscardSide() {
    if (!sideThread) return
    await client.deleteThread(sideThread.id)
    surface.files.openPanel(thread.id)
    revalidate()
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Bare drag strip: the task title and its status already read from
          the sidebar row, so the header carries one action and no rule. It
          spans the activity column too, so its actions stay in the window's
          corner rather than sliding left when that column appears. */}
        <header className="drag-region flex h-10 shrink-0 items-center justify-end gap-1 px-3">
          {projectPath ? (
            <Button
              variant="ghost"
              size="sm"
              className="no-drag text-muted-foreground"
              onClick={() => void handleOpenFolder(projectPath)}
              title={projectPath}
            >
              <FolderOpenIcon data-icon="inline-start" />
              Open folder
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="no-drag text-muted-foreground"
            aria-pressed={panel.open}
            onClick={() => surface.panel.toggle({ threadId })}
          >
            <PanelRightIcon data-icon="inline-start" />
            Panel
          </Button>
        </header>

        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            {messages.length === 0 ? (
              <StatusPanel
                title="Nothing sent yet"
                description="Write the first message to start this task."
              />
            ) : (
              <FilesProvider
                outputs={fileList ?? noOutputs}
                projectPath={projectPath}
                onOpen={openFile}
                onOpenAll={openFiles}
              >
                <MessageStream
                  messages={messages}
                  activities={activities}
                  running={active}
                  progress={state.data.progress}
                  outputs={outputHistory}
                />
              </FilesProvider>
            )}
            <div className="shrink-0 px-6 pb-6">
              {/* The composer takes the conversation's measure so it lines up
                  with the answers rather than out-reaching them. */}
              <div
                className={cn(
                  "mx-auto flex w-full flex-col gap-3",
                  conversationMeasureClassName
                )}
              >
                {taskActionError ? (
                  <InlineError message={taskActionError} />
                ) : null}
                {profileError ? <InlineError message={profileError} /> : null}
                {turnOutputs.state.status === "error" ? (
                  <div className="flex items-center gap-2">
                    <InlineError
                      className="min-w-0 flex-1"
                      message={`Files attached to earlier answers could not be loaded. ${turnOutputs.state.message}`}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={revalidateTurnOutputs}
                    >
                      Try again
                    </Button>
                  </div>
                ) : null}

                {pendingApproval ? (
                  <ApprovalPanel
                    approval={pendingApproval}
                    onResolve={async (decision) => {
                      replace(
                        await client.resolveApproval(
                          thread.id,
                          pendingApproval.id,
                          decision
                        )
                      )
                    }}
                  />
                ) : null}

                <Composer
                  projectId={thread.projectId}
                  harnessId={thread.harnessId}
                  label={`Message for ${thread.title}`}
                  placeholder={
                    active ? "The agent is working…" : "Ask for the next step"
                  }
                  running={active}
                  browserContexts={browserContexts}
                  onRemoveBrowserContext={(id) =>
                    setBrowserContexts((current) =>
                      current.filter((context) => context.id !== id)
                    )
                  }
                  onClearBrowserContexts={(submittedIds) => {
                    const submitted = new Set(submittedIds)
                    setBrowserContexts((current) =>
                      current.filter((context) => !submitted.has(context.id))
                    )
                  }}
                  blockedReason={blockedReason}
                  onSend={async (input) => {
                    replace(await client.startTurn(thread.id, input))
                  }}
                  {...(models.length > 0 && !active
                    ? { onOpenModelPicker: () => setModelMenuOpen(true) }
                    : {})}
                  onCancel={async () => {
                    replace(await client.cancelTurn(thread.id))
                  }}
                  {...(!active
                    ? { onOpenSideChat: () => void handleOpenSide() }
                    : {})}
                  toolbar={
                    models.length > 0 ? (
                      <ExecutionProfileToolbar
                        models={models}
                        profile={thread.executionProfile}
                        onChange={handleProfileChange}
                        harnessId={thread.harnessId}
                        disabled={active}
                        modelMenuOpen={modelMenuOpen}
                        onModelMenuOpenChange={setModelMenuOpen}
                      />
                    ) : null
                  }
                  trailing={
                    thread.contextUsage ? (
                      <ContextUsageMeter usage={thread.contextUsage} />
                    ) : null
                  }
                />
              </div>
            </div>
          </div>
          {/* One slot, two sizes. The column carries the task's plan and
            agents beside the conversation; opening the panel is that same
            information at full width, so the column steps aside rather than
            repeating it. It folds away entirely on a narrow window, where
            the conversation needs the room more. */}
          {!panel.open ? (
            <ActivityAside
              activities={activities}
              childThreads={childThreads}
              onOpen={openActivity}
              onOpenThread={surface.navigation.openTask}
            />
          ) : null}
        </div>
      </div>
      {panel.open ? (
        <TaskPanel
          threadId={threadId}
          activities={activities}
          childThreads={childThreads}
          {...(sideThread ? { sideThread } : {})}
          parentTitle={thread.title}
          files={files.state}
          browserContexts={browserContexts}
          onSelectBrowserElement={(context) =>
            setBrowserContexts((current) =>
              current.length >= 16 ||
              current.some((candidate) => candidate.id === context.id)
                ? current
                : [...current, context]
            )
          }
          onOpenSide={() => void handleOpenSide()}
          onDiscardSide={handleDiscardSide}
        />
      ) : null}
    </div>
  )
}
