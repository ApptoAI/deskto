import { describe, expect, it } from "vitest"

import { ProjectActivityGate } from "./project-activity-gate.js"

describe("ProjectActivityGate", () => {
  it("does not let a turn start while its project is moving", () => {
    const gate = new ProjectActivityGate()
    const finishMove = gate.beginRelocation("project-1")

    expect(() => gate.beginTurn("project-1")).toThrowError(
      expect.objectContaining({ code: "project-moving" })
    )

    finishMove()
    expect(gate.beginTurn("project-1")).toEqual(expect.any(Function))
  })

  it("does not let a project move while one of its turns is active", () => {
    const gate = new ProjectActivityGate()
    const finishTurn = gate.beginTurn("project-1")

    expect(() => gate.beginRelocation("project-1")).toThrowError(
      expect.objectContaining({ code: "project-active" })
    )

    finishTurn()
    expect(gate.beginRelocation("project-1")).toEqual(expect.any(Function))
  })
})
