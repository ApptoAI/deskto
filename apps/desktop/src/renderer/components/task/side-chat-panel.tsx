import { useState } from "react"
import GitBranchIcon from "lucide-react/dist/esm/icons/git-branch"
import Trash2Icon from "lucide-react/dist/esm/icons/trash-2"
import type { Thread, ThreadView } from "@deskto/protocol"

import { Button } from "@workspace/ui/components/button"

import { describedErrorSchema } from "../../runtime/describe-error.js"
import { useRuntimeClient } from "../../runtime/runtime-client-context.js"
import { useThreadView } from "../../runtime/use-thread-view.js"
import { Composer } from "../composer.js"
import { InlineError } from "../inline-error.js"
import { ApprovalPanel } from "./approval-panel.js"
import { MessageStream } from "./message-stream.js"

/**
 * One task's side conversation inside the panel. It reads as a light branch of
 * the main thread — same branch mark the background-task list uses — rather
 * than a second task view.
 */
export function SideChatPanel({
  thread,
  parentTitle,
  onDiscard,
}: {
  thread: Thread
  parentTitle?: string
  onDiscard: () => Promise<void>
}) {
  const client = useRuntimeClient()
  const { state, revalidate, replace } = useThreadView(thread.id)
  const [discardError, setDiscardError] = useState<string | null>(null)

  async function discard() {
    setDiscardError(null)
    try {
      await onDiscard()
    } catch (error) {
      setDiscardError(describedErrorSchema.parse(error))
    }
  }

  if (state.status === "loading" || state.status === "idle") {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <GitBranchIcon aria-hidden className="size-4 animate-pulse" />
        Opening side chat…
      </div>
    )
  }
  if (state.status === "error") {
    return (
      <div className="flex flex-col gap-3 p-4">
        <InlineError message={state.message} />
        <Button variant="outline" size="sm" onClick={revalidate}>
          Try again
        </Button>
      </div>
    )
  }

  const view = state.data
  const approval = view.pendingApproval
  const active =
    view.thread.status === "running" ||
    view.thread.status === "waiting-approval"

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Same height and hairline as the tab strip above it, so the two read
          as one header; the branch mark carries over from the tab. */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <GitBranchIcon
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground"
        />
        <span className="shrink-0 text-ui font-medium">Side chat</span>
        {parentTitle ? (
          <span
            className="min-w-0 flex-1 truncate text-micro text-muted-foreground"
            title={`Branched from ${parentTitle}`}
          >
            from {parentTitle}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          onClick={() => void discard()}
          disabled={active}
          aria-label="Discard side chat"
          title={
            active
              ? "Stop the response before discarding"
              : "Discard this side chat"
          }
        >
          <Trash2Icon />
        </Button>
      </div>
      {discardError ? (
        <InlineError className="m-3 mb-0" message={discardError} />
      ) : null}

      {view.messages.length === 0 && !active && !approval ? (
        <EmptySideChat />
      ) : (
        <MessageStream
          messages={view.messages}
          activities={view.activities}
          running={active}
          {...(view.progress ? { progress: view.progress } : {})}
          outputs={[]}
          label="Side conversation"
        />
      )}

      <div className="shrink-0 px-3 pb-3">
        {approval ? (
          <div className="mb-2">
            <ApprovalPanel
              approval={approval}
              onResolve={async (decision) => {
                replace(
                  await client.resolveApproval(thread.id, approval.id, decision)
                )
              }}
            />
          </div>
        ) : null}
        <SideComposer
          thread={view.thread}
          active={active}
          blocked={approval !== undefined}
          replace={replace}
        />
      </div>
    </div>
  )
}

/** The first-run invitation, in the same voice as the Activities empty state. */
function EmptySideChat() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 pb-6 text-center">
      {/* Outlined tile rather than a bare glyph: it echoes the file rows and
          agent cards so an empty surface still feels like part of the panel. */}
      <span className="flex size-10 items-center justify-center rounded-xl bg-card ring-1 ring-border/60">
        <GitBranchIcon
          aria-hidden
          className="size-5 text-muted-foreground/60"
        />
      </span>
      <p className="text-sm font-medium">Ask without changing direction</p>
      <p className="max-w-56 text-xs text-muted-foreground">
        This chat starts from the main task&apos;s current context. The main
        conversation stays exactly as it is, and discarding removes only this
        chat.
      </p>
    </div>
  )
}

function SideComposer({
  thread,
  active,
  blocked,
  replace,
}: {
  thread: Thread
  active: boolean
  blocked: boolean
  replace: (view: ThreadView) => void
}) {
  const client = useRuntimeClient()
  return (
    <Composer
      projectId={thread.projectId}
      harnessId={thread.harnessId}
      label="Side question"
      placeholder={active ? "The agent is working…" : "Ask a side question"}
      running={active}
      {...(blocked
        ? {
            blockedReason:
              "Answer the request above before sending anything else.",
          }
        : {})}
      onSend={async (input) =>
        replace(await client.startTurn(thread.id, input))
      }
      onCancel={async () => replace(await client.cancelTurn(thread.id))}
    />
  )
}
