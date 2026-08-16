import { describe, expect, it } from "vitest"

import { afterScopeChange, toNewTask, type MainView } from "./work-view.js"

describe("work view navigation", () => {
  it("keeps Skills open when the project scope changes", () => {
    const view: MainView = { kind: "skills", tab: "computer" }

    expect(afterScopeChange(view)).toEqual(view)
  })

  it("closes a task when the project scope changes", () => {
    expect(afterScopeChange({ kind: "task", threadId: "thread-1" })).toEqual({
      kind: "new-task",
    })
  })

  it("rewrites the view behind Settings when starting a new task", () => {
    expect(
      toNewTask({
        kind: "settings",
        page: "agents",
        returnTo: { kind: "skills", tab: "packs" },
      })
    ).toEqual({
      kind: "settings",
      page: "agents",
      returnTo: { kind: "new-task" },
    })
  })
})
