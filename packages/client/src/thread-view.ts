import type { RuntimeEvent, ThreadView } from "@deskto/protocol"

export type ThreadDeltaEvent = Extract<RuntimeEvent, { type: "thread.delta" }>

export type ApplyThreadDeltaResult =
  | { outcome: "applied"; view: ThreadView }
  /** The view already contains this change; keep what is on screen. */
  | { outcome: "stale" }
  /** The delta skips ahead of the view; reload it from the Runtime. */
  | { outcome: "gap" }

/**
 * Folds one `thread.delta` event into a held ThreadView. Deltas only make an
 * open view current: any sequence gap, and any change the fold cannot place,
 * asks the caller to reload instead of guessing.
 */
export function applyThreadDelta(
  view: ThreadView,
  event: ThreadDeltaEvent
): ApplyThreadDeltaResult {
  if (event.threadId !== view.thread.id) return { outcome: "stale" }
  if (event.seq <= view.seq) return { outcome: "stale" }
  if (event.seq > view.seq + 1) return { outcome: "gap" }

  const change = event.change
  if (change.type === "message.appended") {
    const index = view.messages.findIndex(
      (message) => message.id === change.messageId
    )
    if (index < 0) return { outcome: "gap" }
    const messages = [...view.messages]
    const message = messages[index]!
    messages[index] = { ...message, content: message.content + change.text }
    return { outcome: "applied", view: { ...view, messages, seq: event.seq } }
  }

  if (change.type === "message.upserted") {
    const index = view.messages.findIndex(
      (message) => message.id === change.message.id
    )
    const messages = [...view.messages]
    if (index < 0) messages.push(change.message)
    else messages[index] = change.message
    return { outcome: "applied", view: { ...view, messages, seq: event.seq } }
  }

  if (change.type === "activity.upserted") {
    const index = view.activities.findIndex(
      (activity) => activity.id === change.activity.id
    )
    const activities = [...view.activities]
    if (index < 0) activities.push(change.activity)
    else activities[index] = change.activity
    return { outcome: "applied", view: { ...view, activities, seq: event.seq } }
  }

  if (change.type === "progress.updated") {
    return {
      outcome: "applied",
      view: { ...view, progress: change.progress, seq: event.seq },
    }
  }

  if (change.type === "approval.requested") {
    return {
      outcome: "applied",
      view: { ...view, pendingApproval: change.approval, seq: event.seq },
    }
  }

  if (change.type === "approval.resolved") {
    const { pendingApproval, ...rest } = view
    const next =
      pendingApproval && pendingApproval.id === change.approvalId ? rest : view
    return { outcome: "applied", view: { ...next, seq: event.seq } }
  }

  return {
    outcome: "applied",
    view: { ...view, thread: change.thread, seq: event.seq },
  }
}
