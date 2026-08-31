import { useCallback, useEffect, useState } from "react"
import FolderIcon from "lucide-react/dist/esm/icons/folder"
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
const sideChatBlockedMessage =
  "The agent is responding. A side chat can start once it settles."

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
  // Each /side command press bumps the request; the side panel acknowledges
  // once its view is ready and the count returns to zero, so no later mount
  // can re-steal the keyboard. Opening the panel from the tab never bumps it:
  // a click should not move the keyboard.
  const [sideFocusRequest, setSideFocusRequest] = useState(0)
  const handleSideFocusHandled = useCallback(() => {
    setSideFocusRequest(0)
  }, [])
  const [browserContexts, setBrowserContexts] = useState<
    BrowserElementContext[]
  >([])
  const active =
    state.status === "ready" &&
    (state.data.thread.status === "running" ||
      state.data.thread.status === "waiting-approval")

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
  const visibleTaskActionError =
    !active && taskActionError === sideChatBlockedMessage
      ? null
      : taskActionError

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

  async function handleOpenSide(options: { focusComposer?: boolean } = {}) {
    setTaskActionError(null)
    if (sideThread) {
      if (options.focusComposer) {
        setSideFocusRequest((request) => request + 1)
      }
      surface.side.open(thread.id)
      return
    }
    // An existing side chat opens any time; creating one while the parent is
    // mid-response cannot fork cleanly, so say so instead of a failed request.
    if (!sideThread && active) {
      setTaskActionError(sideChatBlockedMessage)
      return
    }
    try {
      replace(await client.createSideThread(thread.id))
      // Only after creation succeeded: a failed request must not leave a
      // pending focus for an unrelated later open.
      if (options.focusComposer) {
        setSideFocusRequest((request) => request + 1)
      }
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
            <div className="shrink-0 px-6 pb-4">
              {/* The composer takes the conversation's measure so it lines up
                  with the answers rather than out-reaching them. */}
              <div
                className={cn(
                  "mx-auto flex w-full flex-col gap-3",
                  conversationMeasureClassName
                )}
              >
                {visibleTaskActionError ? (
                  <InlineError message={visibleTaskActionError} />
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
                    active ? "The agent is working…" : "Do anything…"
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
                    setTaskActionError(null)
                    replace(await client.startTurn(thread.id, input))
                  }}
                  {...(models.length > 0 && !active
                    ? { onOpenModelPicker: () => setModelMenuOpen(true) }
                    : {})}
                  onCancel={async () => {
                    replace(await client.cancelTurn(thread.id))
                  }}
                  {...(!active
                    ? {
                        onOpenSideChat: () =>
                          void handleOpenSide({ focusComposer: true }),
                      }
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

                {/* Where the work is happening, under the box that starts it.
                    A person handing a folder to an agent should be able to see
                    which folder without opening anything, so the path is here
                    rather than a click away — machine-shaped, so it reads as a
                    location rather than as a sentence. */}
                <div className="flex h-9 shrink-0 items-center gap-2 text-caption text-muted-foreground tabular-nums">
                  <FolderIcon className="size-3.5 shrink-0" />
                  {/* The label is a fixed phrase and the path is the part that
                      can give ground, so the label never wraps and the path
                      truncates from the front-heavy end instead. */}
                  <span className="shrink-0 whitespace-nowrap">
                    Managed by Deskto
                  </span>
                  {active ? (
                    <span className="flex items-center gap-2 pl-3">
                      <span
                        aria-hidden
                        className="size-1.5 rounded-full bg-foreground/60 motion-safe:animate-pulse"
                      />
                      {thread.status === "waiting-approval"
                        ? "Needs input"
                        : "Working"}
                    </span>
                  ) : null}
                  {projectPath ? (
                    <span className="ml-auto min-w-0 truncate pl-4 text-micro">
                      {projectPath}
                    </span>
                  ) : null}
                </div>
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
          projectPath={projectPath}
          {...(sideFocusRequest ? { focusRequest: sideFocusRequest } : {})}
          onFocusHandled={handleSideFocusHandled}
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
