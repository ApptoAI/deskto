import type { Activity, Message } from "@deskto/protocol"

import { activityEndedAt, toActivityTree } from "./activity-tree.js"

/**
 * How many tool rows a running Turn keeps on screen. The rest collapse behind
 * a count, newest kept: a live tail is worth watching, the twenty rows above
 * it are not.
 */
export const maximumLiveToolRows = 5

/** One block inside a settled Turn's "Worked for" disclosure. */
export type FoldedItem =
  | { kind: "tools"; key: string; items: Activity[] }
  | { kind: "narration"; key: string; message: Message }

export type LiveItem =
  | { kind: "message"; key: string; message: Message }
  | { kind: "activity"; key: string; activity: Activity }

/**
 * What the thread draws: prose, and the tool calls that produced it. A
 * settled Turn folds its work into one `worked` row. Plans and subagents are
 * not here at all — they are the task's state rather than its transcript, and
 * they belong beside the conversation.
 */
export type TimelineRow =
  | { kind: "message"; key: string; message: Message }
  | {
      kind: "worked"
      key: string
      since: string
      until: string | undefined
      items: FoldedItem[]
    }
  | { kind: "live"; key: string; items: LiveItem[] }

type StreamEntry =
  | { kind: "message"; turnKey: string; order: number; message: Message }
  | { kind: "activity"; turnKey: string; order: number; activity: Activity }

type Segment = {
  prompt: Message | undefined
  body: StreamEntry[]
}

const legacyMiddle = 1_000_000
const legacyTail = Number.MAX_SAFE_INTEGER

export function buildTimeline({
  messages,
  activities,
  running,
}: {
  messages: Message[]
  activities: Activity[]
  running: boolean
}): TimelineRow[] {
  // Only tool work reaches the thread. A subagent's own calls belong to that
  // subagent, and a plan and its agents are read beside the conversation.
  const roots = toActivityTree(activities).map((node) => node.activity)
  const workingTurns = new Set(roots.map((activity) => activity.turnId))
  const activityEnds = new Map<string, string>()
  for (const activity of activities) {
    const endedAt = activityEndedAt(activity)
    const previous = activityEnds.get(activity.turnId)
    if (!previous || endedAt > previous)
      activityEnds.set(activity.turnId, endedAt)
  }
  const segments = toSegments(
    interleaveTurns(messages, roots.filter(isTranscriptActivity))
  )

  return segments.flatMap((segment, index) => {
    const last = index === segments.length - 1
    const live = last && (running || hasStreamingReply(segment))
    const prompt: TimelineRow[] = segment.prompt
      ? [{ kind: "message", key: segment.prompt.id, message: segment.prompt }]
      : []
    return [
      ...prompt,
      ...(live
        ? liveRows(segment)
        : settledRows(
            segment,
            worked(segment, workingTurns),
            activityEndFor(segment, activityEnds)
          )),
    ]
  })
}

function isTranscriptActivity(activity: Activity): boolean {
  const kind = activity.payload?.kind
  return kind !== "plan" && kind !== "subagent"
}

/**
 * Whether a Turn did any work at all, read before plans and subagents are
 * filtered out. A Turn that only spawned agents leaves no row in the thread,
 * and it should still be able to say how long it took.
 */
function worked(segment: Segment, workingTurns: ReadonlySet<string>): boolean {
  const promptTurn = segmentTurnKey(segment)
  if (promptTurn && workingTurns.has(promptTurn)) return true
  return segment.body.some((entry) => workingTurns.has(entry.turnKey))
}

function segmentTurnKey(segment: Segment): string | undefined {
  return (
    segment.prompt?.turnId ?? segment.prompt?.id ?? segment.body[0]?.turnKey
  )
}

function activityEndFor(
  segment: Segment,
  activityEnds: ReadonlyMap<string, string>
): string | undefined {
  const turnKey = segmentTurnKey(segment)
  return turnKey ? activityEnds.get(turnKey) : undefined
}

/**
 * Merges each Turn's messages and root activities into one chronological list.
 * Both carry a shared per-turn ordinal; rows written before it existed fall
 * back to the old layout, activities ahead of the assistant text.
 */
function interleaveTurns(
  messages: Message[],
  activities: Activity[]
): StreamEntry[] {
  const entries: StreamEntry[] = messages.map((message) => ({
    kind: "message",
    turnKey: message.turnId ?? message.id,
    order: message.ordinal ?? (message.role === "user" ? -1 : legacyTail),
    message,
  }))
  for (const [index, activity] of activities.entries()) {
    entries.push({
      kind: "activity",
      turnKey: activity.turnId,
      order: activity.ordinal ?? legacyMiddle + index,
      activity,
    })
  }

  const turnOrder = new Map<string, number>()
  for (const message of messages) {
    const turnId = message.turnId ?? message.id
    if (!turnOrder.has(turnId)) turnOrder.set(turnId, turnOrder.size)
  }
  return entries.sort((left, right) => {
    const leftTurn = turnOrder.get(left.turnKey) ?? Number.MAX_SAFE_INTEGER
    const rightTurn = turnOrder.get(right.turnKey) ?? Number.MAX_SAFE_INTEGER
    if (leftTurn !== rightTurn) return leftTurn - rightTurn
    return left.order - right.order
  })
}

/** A prompt opens a segment and closes the one before it. */
function toSegments(entries: StreamEntry[]): Segment[] {
  const segments: Segment[] = []
  let current: Segment = { prompt: undefined, body: [] }
  for (const entry of entries) {
    if (entry.kind === "message" && entry.message.role === "user") {
      if (current.prompt || current.body.length > 0) segments.push(current)
      current = { prompt: entry.message, body: [] }
      continue
    }
    current.body.push(entry)
  }
  if (current.prompt || current.body.length > 0) segments.push(current)
  return segments
}

function hasStreamingReply(segment: Segment): boolean {
  return segment.body.some(
    (entry) => entry.kind === "message" && entry.message.state === "streaming"
  )
}

/**
 * A running Turn: prose stays where it lands while older tool calls can fold
 * behind one Turn-wide count. It carries no elapsed header of its own — the
 * working indicator at the tail already counts, and two timers on one Turn is
 * one timer too many.
 */
function liveRows(segment: Segment): TimelineRow[] {
  if (segment.body.length === 0) return []
  const items: LiveItem[] = segment.body.map((entry) =>
    entry.kind === "message"
      ? { kind: "message", key: entry.message.id, message: entry.message }
      : { kind: "activity", key: entry.activity.id, activity: entry.activity }
  )
  return [
    {
      kind: "live",
      key: `live:${segmentTurnKey(segment) ?? items[0]!.key}`,
      items,
    },
  ]
}

/**
 * A settled Turn: one disclosure carrying every tool call and every preamble,
 * and the answer it arrived at.
 */
function settledRows(
  segment: Segment,
  hadWork: boolean,
  activityEnd: string | undefined
): TimelineRow[] {
  const folded: FoldedItem[] = []
  const tail: TimelineRow[] = []
  let pendingTools: Activity[] = []

  const flushTools = () => {
    if (pendingTools.length === 0) return
    folded.push({
      kind: "tools",
      key: `tools:${pendingTools[0]!.id}`,
      items: pendingTools,
    })
    pendingTools = []
  }

  const reply = terminalReply(segment.body)
  for (const entry of segment.body) {
    if (entry.kind === "activity") {
      pendingTools.push(entry.activity)
      continue
    }
    flushTools()
    const message = entry.message
    // A notice is not the agent's working out; it stays where it was written.
    if (message.role === "system") {
      tail.push({ kind: "message", key: message.id, message })
      continue
    }
    if (message.id === reply?.id) continue
    folded.push({ kind: "narration", key: message.id, message })
  }
  flushTools()

  const since = segment.prompt?.createdAt ?? startOf(segment.body)
  // The header survives an empty fold. A Turn whose whole run was subagents
  // has nothing to show here, and saying how long it took beats saying
  // nothing; the row drops its toggle rather than opening onto blank space.
  const fold: TimelineRow[] =
    since && hadWork
      ? [
          {
            kind: "worked",
            key: `worked:${segment.prompt?.id ?? since}`,
            since,
            until: activityEnd,
            items: folded,
          },
        ]
      : []
  const answer: TimelineRow[] = reply
    ? [{ kind: "message", key: reply.id, message: reply }]
    : []
  return [...fold, ...tail, ...answer]
}

/** The answer a Turn ended on: its last assistant message with something to say. */
function terminalReply(body: StreamEntry[]): Message | undefined {
  for (let index = body.length - 1; index >= 0; index--) {
    const entry = body[index]
    if (entry?.kind !== "message") continue
    const message = entry.message
    if (message.role !== "assistant") continue
    if (message.state === "complete" && !message.content) continue
    return message
  }
  return undefined
}

function startOf(body: StreamEntry[]): string | undefined {
  const first = body[0]
  if (!first) return undefined
  return first.kind === "message"
    ? first.message.createdAt
    : first.activity.createdAt
}

/**
 * The tail of a running Turn's tool calls, preserving all prose around it.
 * The cap applies to the Turn as a whole, even when narration splits calls
 * into several visual clusters.
 */
export function capLiveItems(items: LiveItem[], expanded: boolean) {
  const toolCount = items.reduce(
    (count, item) => count + Number(item.kind === "activity"),
    0
  )
  if (expanded || toolCount <= maximumLiveToolRows) {
    return { visible: items, hidden: 0 }
  }
  let toHide = toolCount - maximumLiveToolRows
  return {
    visible: items.filter((item) => {
      if (item.kind === "message" || toHide === 0) return true
      toHide--
      return false
    }),
    hidden: toolCount - maximumLiveToolRows,
  }
}
