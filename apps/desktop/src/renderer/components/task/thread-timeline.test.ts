import { describe, expect, it } from "vitest"
import type { Activity, Message, TurnOutput } from "@deskto/protocol"

import { buildTimeline, capLiveItems } from "./thread-timeline.js"

function prompt(id: string, ordinal = 0): Message {
  return {
    id,
    threadId: "thread-1",
    turnId: id,
    role: "user",
    content: `prompt ${id}`,
    state: "complete",
    ordinal,
    createdAt: "2026-08-16T10:00:00.000Z",
  }
}

function reply(
  id: string,
  turnId: string,
  content: string,
  ordinal: number,
  state: Message["state"] = "complete"
): Message {
  return {
    id,
    threadId: "thread-1",
    turnId,
    role: "assistant",
    content,
    state,
    ordinal,
    createdAt: "2026-08-16T10:00:05.000Z",
  }
}

function tool(id: string, turnId: string, ordinal: number): Activity {
  return {
    id,
    threadId: "thread-1",
    turnId,
    name: `Ran ${id}`,
    status: "completed",
    payload: { kind: "tool", tool: "command" },
    ordinal,
    createdAt: "2026-08-16T10:00:01.000Z",
    finishedAt: "2026-08-16T10:00:02.000Z",
  }
}

function output(id: string, turnId: string): TurnOutput {
  const timestamp = "2026-08-16T10:00:06.000Z"
  return {
    turnId,
    producedAt: timestamp,
    artifact: {
      id,
      projectId: "project-1",
      name: `${id}.xlsx`,
      relativePath: `${id}.xlsx`,
      mediaType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      previewKind: "spreadsheet",
      openable: true,
      sizeBytes: 42,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  }
}

function subagent(
  id: string,
  turnId: string,
  ordinal: number,
  status: Activity["status"] = "completed"
): Activity {
  const activity: Activity = {
    id,
    threadId: "thread-1",
    turnId,
    name: `Agent ${id}`,
    status,
    payload: { kind: "subagent", agentType: "Explore" },
    ordinal,
    createdAt: "2026-08-16T10:00:01.000Z",
  }
  if (status === "completed") activity.finishedAt = "2026-08-16T10:00:09.000Z"
  return activity
}

describe("thread timeline", () => {
  it("folds a settled turn's tool calls and preambles behind one disclosure", () => {
    const rows = buildTimeline({
      messages: [
        prompt("turn-1"),
        reply("preamble", "turn-1", "Looking into it.", 1),
        reply("answer", "turn-1", "Here is the result.", 4),
      ],
      activities: [tool("a", "turn-1", 2), tool("b", "turn-1", 3)],
      running: false,
    })

    expect(rows.map((row) => row.kind)).toEqual([
      "message",
      "worked",
      "message",
    ])
    const worked = rows[1]
    if (worked?.kind !== "worked") throw new Error("expected a worked row")
    expect(worked.items.map((item) => item.kind)).toEqual([
      "narration",
      "tools",
    ])
    expect(rows[2]).toMatchObject({ kind: "message", key: "answer" })
  })

  it("keeps a running turn's work open and unfolded", () => {
    const rows = buildTimeline({
      messages: [prompt("turn-1")],
      activities: [tool("a", "turn-1", 1), tool("b", "turn-1", 2)],
      running: true,
    })

    expect(rows.map((row) => row.kind)).toEqual(["message", "live"])
  })

  it("puts a settled Turn's files after its answer and shows live outputs", () => {
    const settled = buildTimeline({
      messages: [prompt("turn-1"), reply("answer", "turn-1", "Done.", 1)],
      activities: [],
      outputs: [output("forecast", "turn-1"), output("other", "turn-2")],
      running: false,
    })

    expect(settled.map((row) => row.kind)).toEqual([
      "message",
      "message",
      "files",
    ])
    expect(settled[2]).toMatchObject({
      kind: "files",
      outputs: [{ artifact: { id: "forecast" } }],
    })

    const live = buildTimeline({
      messages: [
        prompt("turn-1"),
        reply("answer", "turn-1", "Still working.", 1, "streaming"),
      ],
      activities: [],
      outputs: [output("forecast", "turn-1")],
      running: true,
    })
    expect(live.map((row) => row.kind)).toEqual(["message", "live", "files"])
  })

  it("treats a streaming reply as live even when the thread reads idle", () => {
    const rows = buildTimeline({
      messages: [
        prompt("turn-1"),
        reply("answer", "turn-1", "Partial", 2, "streaming"),
      ],
      activities: [tool("a", "turn-1", 1)],
      running: false,
    })

    expect(rows.map((row) => row.kind)).toEqual(["message", "live"])
  })

  it("keeps plans and subagents out of the conversation entirely", () => {
    const plan: Activity = {
      id: "plan-1",
      threadId: "thread-1",
      turnId: "turn-1",
      name: "Working plan",
      status: "completed",
      payload: {
        kind: "plan",
        steps: [{ text: "Read the code", status: "done" }],
      },
      ordinal: 1,
      createdAt: "2026-08-16T10:00:01.000Z",
    }
    const rows = buildTimeline({
      messages: [prompt("turn-1"), reply("answer", "turn-1", "Done.", 5)],
      activities: [
        plan,
        tool("a", "turn-1", 2),
        subagent("s1", "turn-1", 3),
        subagent("s2", "turn-1", 4),
      ],
      running: false,
    })

    expect(rows.map((row) => row.kind)).toEqual([
      "message",
      "worked",
      "message",
    ])
    const worked = rows[1]
    if (worked?.kind !== "worked") throw new Error("expected a worked row")
    expect(worked.items).toHaveLength(1)
    expect(worked.items[0]).toMatchObject({ kind: "tools" })
  })

  it("keeps a subagent's own tool calls out of the thread", () => {
    const nested: Activity = {
      ...tool("nested", "turn-1", 3),
      parentActivityId: "s1",
    }
    const rows = buildTimeline({
      messages: [prompt("turn-1"), reply("answer", "turn-1", "Done.", 4)],
      activities: [subagent("s1", "turn-1", 2), nested],
      running: false,
    })

    // Nothing is left to unfold, but the Turn still reports how long it ran.
    expect(rows.map((row) => row.kind)).toEqual([
      "message",
      "worked",
      "message",
    ])
    const worked = rows[1]
    if (worked?.kind !== "worked") throw new Error("expected a worked row")
    expect(worked.items).toEqual([])
  })

  it("draws no worked header for a turn that did no work", () => {
    const rows = buildTimeline({
      messages: [prompt("turn-1"), reply("answer", "turn-1", "Hello.", 1)],
      activities: [],
      running: false,
    })

    expect(rows.map((row) => row.kind)).toEqual(["message", "message"])
  })

  it("folds every settled turn but the live one", () => {
    const rows = buildTimeline({
      messages: [
        prompt("turn-1"),
        reply("answer-1", "turn-1", "First answer.", 2),
        prompt("turn-2"),
      ],
      activities: [tool("a", "turn-1", 1), tool("b", "turn-2", 1)],
      running: true,
    })

    expect(rows.map((row) => row.kind)).toEqual([
      "message",
      "worked",
      "message",
      "message",
      "live",
    ])
  })

  it("caps tool calls across narration in one live Turn", () => {
    const calls = ["a", "b", "c", "d", "e", "f", "g"].map((id, index) => ({
      kind: "activity" as const,
      key: id,
      activity: tool(id, "turn-1", index),
    }))
    const narration = {
      kind: "message" as const,
      key: "narration",
      message: reply("narration", "turn-1", "Still working.", 4),
    }
    const items = [...calls.slice(0, 4), narration, ...calls.slice(4)]

    expect(capLiveItems(items, false)).toEqual({
      visible: [...calls.slice(-5, -3), narration, ...calls.slice(-3)],
      hidden: 2,
    })
    expect(capLiveItems(items, true)).toEqual({ visible: items, hidden: 0 })
    expect(capLiveItems(calls.slice(0, 3), false)).toEqual({
      visible: calls.slice(0, 3),
      hidden: 0,
    })
  })

  it("ends a settled Turn at its last Activity, including subagent work", () => {
    const answer = reply("answer", "turn-1", "Done.", 3)
    answer.createdAt = "2026-08-16T10:00:20.000Z"
    const rows = buildTimeline({
      messages: [prompt("turn-1"), answer],
      activities: [tool("a", "turn-1", 1), subagent("agent", "turn-1", 2)],
      running: false,
    })

    const worked = rows.find((row) => row.kind === "worked")
    expect(worked).toMatchObject({ until: "2026-08-16T10:00:09.000Z" })
  })

  it("ends a segment at the latest Activity across its Turn keys", () => {
    const rows = buildTimeline({
      messages: [
        prompt("prompt-turn"),
        reply("answer", "provider-turn", "Done.", 2),
      ],
      activities: [subagent("agent", "provider-turn", 1)],
      running: false,
    })

    const worked = rows.find((row) => row.kind === "worked")
    expect(worked).toMatchObject({ until: "2026-08-16T10:00:09.000Z" })
  })
})
