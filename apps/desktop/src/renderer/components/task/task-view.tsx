import { useCallback, useEffect, useState } from "react"
import FolderOpenIcon from "lucide-react/dist/esm/icons/folder-open"
import PanelRightIcon from "lucide-react/dist/esm/icons/panel-right"
import { hasUnreadCompletion, threadCameBack } from "@deskto/client"
import type { ExecutionProfile, Harness, Project } from "@deskto/protocol"

import { Button } from "@workspace/ui/components/button"

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
import { ApprovalPanel } from "./approval-panel.js"
import { MessageStream } from "./message-stream.js"
import {
  openResultTab,
  retainResultTabs,
  useOpenNewestResult,
} from "./result-tabs.js"
import { ResultsProvider } from "./results-context.js"
import { ResultsPanel } from "./results-panel.js"

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
  const [resultsOpen, setResultsOpen] = useState(false)
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

  // The results live here rather than inside the panel: the conversation
  // needs them to turn a reported file into a link, and the header needs
  // their count whether the panel is open or not.
  const loadResults = useCallback(
    () => client.listResults(threadId),
    [client, threadId]
  )
  const results = useRuntimeQuery(loadResults)
  const revalidateResults = results.revalidate
  useRuntimeEvent(
    "artifact.changed",
    useCallback(
      (event) => {
        if (event.threadId === threadId) revalidateResults()
      },
      [revalidateResults, threadId]
    )
  )
  const resultList =
    results.state.status === "ready" ? results.state.data : undefined
  useEffect(() => {
    if (resultList) {
      retainResultTabs(
        threadId,
        resultList.map((output) => output.artifact.id)
      )
    }
  }, [resultList, threadId])
  useOpenNewestResult(threadId, resultList?.[0]?.artifact.id, resultsOpen)

  const openResult = useCallback(
    (artifactId: string) => {
      setResultsOpen(true)
      openResultTab(threadId, artifactId)
    },
    [threadId]
  )

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
          the sidebar row, so the header carries one action and no rule. */}
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
            aria-pressed={resultsOpen}
            onClick={() => setResultsOpen((open) => !open)}
          >
            <PanelRightIcon data-icon="inline-start" />
            Results
            {resultList && resultList.length > 0 ? (
              <span className="text-muted-foreground tabular-nums">
                {resultList.length}
              </span>
            ) : null}
          </Button>
        </header>

        {messages.length === 0 ? (
          <StatusPanel
            title="Nothing sent yet"
            description="Write the first message to start this task."
          />
        ) : (
          <ResultsProvider
            outputs={resultList ?? []}
            projectPath={projectPath}
            onOpen={openResult}
          >
            <MessageStream
              messages={messages}
              activities={activities}
              running={active}
            />
          </ResultsProvider>
        )}

        <div className="shrink-0 px-6 pb-6">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
            {folderError ? <InlineError message={folderError} /> : null}
            {profileError ? <InlineError message={profileError} /> : null}

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
      {resultsOpen ? (
        <ResultsPanel
          threadId={threadId}
          results={results.state}
          onClose={() => setResultsOpen(false)}
        />
      ) : null}
    </div>
  )
}
