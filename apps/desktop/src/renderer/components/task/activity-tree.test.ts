import { describe, expect, it } from "vitest"
import type { Activity } from "@deskto/protocol"

import { newestPlan, subagentNodes, toActivityTree } from "./activity-tree.js"

function activity(
  id: string,
  payload?: Activity["payload"],
  parentActivityId?: string
): Activity {
  const row: Activity = {
    id,
    threadId: "thread-1",
    turnId: "turn-1",
    name: id,
    status: "completed",
    createdAt: "2026-08-16T10:00:00.000Z",
  }
  if (payload) row.payload = payload
  if (parentActivityId) row.parentActivityId = parentActivityId
  return row
}

const plan = (id: string, parentActivityId?: string) =>
  activity(
    id,
    { kind: "plan", steps: [{ text: id, status: "pending" }] },
    parentActivityId
  )

const agent = (id: string, parentActivityId?: string) =>
  activity(id, { kind: "subagent" }, parentActivityId)

describe("toActivityTree", () => {
  it("nests work under the activity that spawned it", () => {
    const tree = toActivityTree([
      agent("agent-1"),
      activity("tool-1", undefined, "agent-1"),
      activity("tool-2"),
    ])

    expect(tree.map((node) => node.activity.id)).toEqual(["agent-1", "tool-2"])
    expect(tree[0]?.children.map((node) => node.activity.id)).toEqual([
      "tool-1",
    ])
  })

  it("surfaces work whose parent is missing rather than dropping it", () => {
    const tree = toActivityTree([activity("tool-1", undefined, "gone")])

    expect(tree.map((node) => node.activity.id)).toEqual(["tool-1"])
  })

  it("survives a cycle without losing either side of it", () => {
    const tree = toActivityTree([
      activity("a", undefined, "b"),
      activity("b", undefined, "a"),
    ])

    expect(tree.map((node) => node.activity.id)).toEqual(["a"])
    expect(tree[0]?.children.map((node) => node.activity.id)).toEqual(["b"])
  })

  it("surfaces repeated identifiers as separate roots", () => {
    const first = activity("same")
    const second = activity("same")
    first.name = "first"
    second.name = "second"

    const tree = toActivityTree([first, second])

    expect(tree.map((node) => node.activity.name)).toEqual(["first", "second"])
  })
})

describe("subagentNodes", () => {
  it("returns a nested agent inside its parent rather than beside it", () => {
    const tree = toActivityTree([
      agent("agent-1"),
      agent("agent-2", "agent-1"),
      activity("tool-1", undefined, "agent-2"),
    ])
    const agents = subagentNodes(tree)

    expect(agents.map((node) => node.activity.id)).toEqual(["agent-1"])
    expect(agents[0]?.children.map((node) => node.activity.id)).toEqual([
      "agent-2",
    ])
  })

  it("finds an agent buried under ordinary work", () => {
    const tree = toActivityTree([
      activity("tool-1"),
      agent("agent-1", "tool-1"),
    ])

    expect(subagentNodes(tree).map((node) => node.activity.id)).toEqual([
      "agent-1",
    ])
  })
})

describe("newestPlan", () => {
  it("takes the newest plan the task itself wrote", () => {
    const tree = toActivityTree([plan("plan-1"), plan("plan-2")])

    expect(newestPlan(tree)?.id).toBe("plan-2")
  })

  it("ignores a plan a subagent wrote for its own errand", () => {
    // Codex nests a delegated thread's plan under the agent running it.
    const tree = toActivityTree([
      plan("plan-1"),
      agent("agent-1"),
      plan("agent-plan", "agent-1"),
    ])

    expect(newestPlan(tree)?.id).toBe("plan-1")
  })

  it("has nothing to show without a plan", () => {
    expect(newestPlan(toActivityTree([activity("tool-1")]))).toBeUndefined()
  })
})
