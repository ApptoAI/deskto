import { useCallback, useEffect, useState } from "react"
import FolderOpenIcon from "lucide-react/dist/esm/icons/folder-open"
import PanelRightIcon from "lucide-react/dist/esm/icons/panel-right"
import { hasUnreadCompletion, threadCameBack } from "@deskto/client"
import type {
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
import { Composer } from "../composer.js"
import { ContextUsageMeter } from "../context-usage-meter.js"
import { ExecutionProfileToolbar } from "../execution-profile/execution-profile-toolbar.js"
import { InlineError } from "../inline-error.js"
import { StatusPanel } from "../status-panel.js"
import { ActivityAside } from "./activity-aside.js"
import { ApprovalPanel } from "./approval-panel.js"
import { MessageStream } from "./message-stream.js"
import { FilesProvider } from "./files-context.js"
import { TaskPanel } from "./task-panel.js"
import { conversationMeasureClassName } from "./task-panel-size.js"
import {
  retainSelectedFile,
  showActivities,
  showFile,
  showFilesOverview,
} from "./task-panel-state.js"

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
  const { state, revalidate, replace } = useThreadView(threadId)
  const [folderError, setFolderError] = useState<string | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)

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
      retainSelectedFile(
        threadId,
        fileList.map((output) => output.artifact.id)
      )
    }
  }, [fileList, threadId])
  const outputHistory =
    turnOutputs.state.status === "ready" ? turnOutputs.state.data : noOutputs

  const openFile = useCallback(
    (artifactId: string) => {
      setPanelOpen(true)
      showFile(threadId, artifactId)
    },
    [threadId]
  )
  const openFiles = useCallback(() => {
    setPanelOpen(true)
    showFilesOverview(threadId)
  }, [threadId])
  const openActivity = useCallback(() => {
    setPanelOpen(true)
    showActivities(threadId)
  }, [threadId])

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

  const { thread, messages, activities, pendingApproval } = state.data
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
    setFolderError(null)
    try {
      await openFolder(path)
    } catch (error) {
      setFolderError(describedErrorSchema.parse(error))
    }
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
            aria-pressed={panelOpen}
            onClick={() => setPanelOpen((open) => !open)}
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
                {folderError ? <InlineError message={folderError} /> : null}
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
                  workspaceId={project.workspaceId}
                  label={`Message for ${thread.title}`}
                  placeholder={
                    active ? "The agent is working…" : "Ask for the next step"
                  }
                  running={active}
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
          {!panelOpen ? (
            <ActivityAside activities={activities} onOpen={openActivity} />
          ) : null}
        </div>
      </div>
      {panelOpen ? (
        <TaskPanel
          threadId={threadId}
          activities={activities}
          files={files.state}
          onClose={() => setPanelOpen(false)}
        />
      ) : null}
    </div>
  )
}
