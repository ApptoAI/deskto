import { useCallback, useEffect, useState } from "react"
import { hasUnreadCompletion, threadCameBack } from "@openappto/client"
import type { ExecutionProfile, Harness } from "@openappto/protocol"

import { Button } from "@workspace/ui/components/button"

import {
  describeHarnessBlock,
  findHarness,
  harnessLabel,
} from "../../lib/harness.js"
import { describeThreadStatus } from "../../lib/thread-status.js"
import { describeError } from "../../runtime/describe-error.js"
import { useRuntimeClient } from "../../runtime/runtime-client-context.js"
import {
  useRuntimeQuery,
  type QueryState,
} from "../../runtime/use-runtime-query.js"
import { useThreadChanged } from "../../runtime/use-thread-changed.js"
import { HarnessLogo } from "../brand-logos.js"
import { Composer } from "../composer.js"
import { ContextUsageMeter } from "../context-usage-meter.js"
import { ExecutionProfileToolbar } from "../execution-profile/execution-profile-toolbar.js"
import { InlineError } from "../inline-error.js"
import { StatusPanel } from "../status-panel.js"
import { ApprovalPanel } from "./approval-panel.js"
import { MessageStream } from "./message-stream.js"

export function TaskView({
  threadId,
  harnesses,
}: {
  threadId: string
  harnesses: QueryState<Harness[]>
}) {
  const client = useRuntimeClient()
  const load = useCallback(() => client.getThread(threadId), [client, threadId])
  const { state, revalidate, replace } = useRuntimeQuery(load)
  const [profileError, setProfileError] = useState<string | null>(null)

  useThreadChanged(
    useCallback(
      (changedThreadId: string) => {
        if (changedThreadId === threadId) revalidate()
      },
      [threadId, revalidate]
    )
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
  const status = describeThreadStatus(thread.status)
  const options = harnesses.status === "ready" ? harnesses.data : []
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
      setProfileError(describeError(error))
    }
  }

  return (
    <>
      <header className="drag-region flex h-10 shrink-0 items-center gap-3 border-b border-border px-6">
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
          {thread.title}
        </h1>
        <p className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          <HarnessLogo harnessId={thread.harnessId} className="size-3.5" />
          <span>{harnessLabel(options, thread.harnessId)}</span>
          <span aria-hidden>·</span>
          <span className={status.textClassName}>{status.label}</span>
        </p>
      </header>

      {messages.length === 0 ? (
        <StatusPanel
          title="Nothing sent yet"
          description="Write the first message to start this task."
        />
      ) : (
        <MessageStream
          messages={messages}
          activities={activities}
          running={active}
        />
      )}

      <div className="shrink-0 px-6 pb-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
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
            label={`Message for ${thread.title}`}
            placeholder={
              active ? "The agent is working…" : "Ask for the next step"
            }
            running={active}
            blockedReason={blockedReason}
            onSend={async (prompt) => {
              replace(await client.startTurn(thread.id, prompt))
            }}
            onCancel={async () => {
              replace(await client.cancelTurn(thread.id))
            }}
            toolbar={
              models.length > 0 ? (
                <ExecutionProfileToolbar
                  models={models}
                  profile={thread.executionProfile}
                  onChange={handleProfileChange}
                  disabled={active}
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
    </>
  )
}
