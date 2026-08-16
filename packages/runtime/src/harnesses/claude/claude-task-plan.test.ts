import { describe, expect, it } from "vitest"

import { ClaudeTaskPlan, isTaskPlanTool } from "./claude-task-plan.js"

function createResult(id: string, subject: string): string {
  return `Task #${id} created successfully: ${subject}`
}

describe("isTaskPlanTool", () => {
  it("claims the tools that manage the list, not the work", () => {
    expect(isTaskPlanTool("TaskCreate")).toBe(true)
    expect(isTaskPlanTool("TaskUpdate")).toBe(true)
    expect(isTaskPlanTool("TaskList")).toBe(true)
    expect(isTaskPlanTool("TaskGet")).toBe(true)
    expect(isTaskPlanTool("Task")).toBe(false)
    expect(isTaskPlanTool("Bash")).toBe(false)
  })
})

describe("ClaudeTaskPlan", () => {
  it("shows a task as soon as it is created, before its id is known", () => {
    const plan = new ClaudeTaskPlan()

    expect(plan.created("call-1", { subject: "Read the code" })).toBe(true)
    expect(plan.steps()).toEqual([{ text: "Read the code", status: "pending" }])
  })

  it("keeps creation order", () => {
    const plan = new ClaudeTaskPlan()
    plan.created("call-1", { subject: "Read the code" })
    plan.created("call-2", { subject: "Write the fix" })
    plan.bind("call-1", "5")
    plan.bind("call-2", "6")

    expect(plan.steps()).toEqual([
      { text: "Read the code", status: "pending" },
      { text: "Write the fix", status: "pending" },
    ])
  })

  it("moves a bound task through its statuses", () => {
    const plan = new ClaudeTaskPlan()
    plan.created("call-1", { subject: "Read the code" })
    plan.bind("call-1", "5", "Read the code")

    expect(plan.updated({ taskId: "5", status: "in_progress" })).toBe(true)
    expect(plan.steps()).toEqual([{ text: "Read the code", status: "active" }])

    plan.updated({ taskId: "5", status: "completed" })
    expect(plan.steps()).toEqual([{ text: "Read the code", status: "done" }])
  })

  it("binds the same pair twice without duplicating or redrawing the task", () => {
    const plan = new ClaudeTaskPlan()
    plan.created("call-1", { subject: "Read the code" })

    // The hook and the create's own answer both report this pair. Neither
    // changes what the plan reads, so neither asks for a redraw.
    expect(plan.bind("call-1", "5", "Read the code")).toBe(false)
    expect(
      plan.resolveCreated("call-1", createResult("5", "Read the code"))
    ).toBe(false)
    plan.updated({ taskId: "5", status: "completed" })

    expect(plan.steps()).toEqual([{ text: "Read the code", status: "done" }])
  })

  it("never invents a step named after an id it has not placed", () => {
    const plan = new ClaudeTaskPlan()
    plan.created("call-1", { subject: "Read the code" })

    // The binding never arrived, so this update names a task the plan cannot
    // find. The old bug drew it as a step called "5".
    expect(plan.updated({ taskId: "5", status: "completed" })).toBe(false)
    expect(plan.steps()).toEqual([{ text: "Read the code", status: "pending" }])
  })

  it("never invents a step from an update that renames a task", () => {
    const plan = new ClaudeTaskPlan()
    plan.created("call-1", { subject: "Policzyć statystyki od zera" })

    // The rename-and-complete that used to draw a second, struck-through row
    // beside the original.
    expect(
      plan.updated({
        taskId: "5",
        subject: "Policzyć statystyki dla test-sprzedaz-2026.csv",
        status: "completed",
      })
    ).toBe(false)
    expect(plan.steps()).toHaveLength(1)

    // It lands on the original task the moment the binding arrives.
    expect(plan.bind("call-1", "5")).toBe(true)
    expect(plan.steps()).toEqual([
      {
        text: "Policzyć statystyki dla test-sprzedaz-2026.csv",
        status: "done",
      },
    ])
  })

  it("reads the id out of the CLI's plain-text answer", () => {
    const plan = new ClaudeTaskPlan()
    plan.created("call-1", { subject: "Read the code" })

    expect(
      plan.resolveCreated(
        "call-1",
        "Task #12 created successfully: Read the code"
      )
    ).toBe(false)
    expect(plan.updated({ taskId: "12", status: "completed" })).toBe(true)
    expect(plan.steps()).toEqual([{ text: "Read the code", status: "done" }])
  })

  it("binds even when the answer omits the subject", () => {
    const plan = new ClaudeTaskPlan()
    plan.created("call-1", { subject: "Read the code" })

    plan.resolveCreated("call-1", "Task #12 created successfully")
    expect(plan.updated({ taskId: "12", status: "in_progress" })).toBe(true)
    expect(plan.steps()).toEqual([{ text: "Read the code", status: "active" }])
  })

  it("applies a status that arrived before its binding", () => {
    const plan = new ClaudeTaskPlan()
    plan.created("call-1", { subject: "Read the code" })
    plan.updated({ taskId: "5", status: "completed" })

    expect(plan.bind("call-1", "5")).toBe(true)
    expect(plan.steps()).toEqual([{ text: "Read the code", status: "done" }])
  })

  it("applies a binding that arrived before the call it belongs to", () => {
    const plan = new ClaudeTaskPlan()

    expect(plan.bind("call-1", "5", "Read the code")).toBe(false)
    plan.created("call-1", { subject: "Read the code" })
    plan.updated({ taskId: "5", status: "in_progress" })

    expect(plan.steps()).toEqual([{ text: "Read the code", status: "active" }])
  })

  it("takes a subject from an update that carries one", () => {
    const plan = new ClaudeTaskPlan()
    plan.created("call-1", { subject: "Read the code" })
    plan.bind("call-1", "5")

    plan.updated({ taskId: "5", subject: "Read the adapter" })
    expect(plan.steps()).toEqual([
      { text: "Read the adapter", status: "pending" },
    ])
  })

  it("drops a deleted task and ignores a delete it cannot place", () => {
    const plan = new ClaudeTaskPlan()
    plan.created("call-1", { subject: "Read the code" })
    plan.bind("call-1", "5")

    expect(plan.updated({ taskId: "9", status: "deleted" })).toBe(false)
    expect(plan.updated({ taskId: "5", status: "deleted" })).toBe(true)
    expect(plan.steps()).toEqual([])
  })

  it("ignores calls and answers it cannot read", () => {
    const plan = new ClaudeTaskPlan()

    expect(plan.created("call-1", { nope: true })).toBe(false)
    expect(plan.resolveCreated("call-1", "not json")).toBe(false)
    expect(plan.updated({ nope: true })).toBe(false)
    expect(plan.steps()).toEqual([])
  })
})
