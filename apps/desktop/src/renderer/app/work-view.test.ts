import { describe, expect, it } from "vitest"

import { afterScopeChange, toNewTask, type MainView } from "./work-view.js"

describe("work view navigation", () => {
  it("keeps Skills open when the project scope changes", () => {
    const view: MainView = { kind: "skills", filter: "computer" }

    expect(afterScopeChange(view)).toEqual(view)
  })

  it("closes a task when the project scope changes", () => {
    expect(afterScopeChange({ kind: "task", threadId: "thread-1" })).toEqual({
      kind: "new-task",
    })
  })

  it("leaves an open new-task view untouched so a draft survives", () => {
    const view: MainView = { kind: "new-task", projectId: "project-1" }

    expect(toNewTask(view)).toBe(view)
  })

  it("keeps a new-task view's projectId across a scope change", () => {
    const view: MainView = { kind: "new-task", projectId: "project-1" }

    // A stale id is filtered later by lookup; the view just passes through.
    expect(afterScopeChange(view)).toBe(view)
  })

  it("rewrites the view behind Settings when starting a new task", () => {
    expect(
      toNewTask({
        kind: "settings",
        page: "agents",
        returnTo: { kind: "skills", filter: "workspace" },
      })
    ).toEqual({
      kind: "settings",
      page: "agents",
      returnTo: { kind: "new-task" },
    })
  })
})
