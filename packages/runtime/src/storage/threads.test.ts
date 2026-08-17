import { describe, expect, it } from "vitest"

import { ThreadSequences } from "../thread-sequences.js"
import { openDatabase } from "./database.js"
import { Store } from "./store.js"

describe("Threads storage", () => {
  it("forgets sequence cursors for every task removed by a cascade", () => {
    const sequences = new ThreadSequences()
    const store = new Store(openDatabase(":memory:"), sequences)
    try {
      const project = store.projects.add("/tmp/example", "Example", "personal")
      const profile = {
        modelId: "gpt-5",
        effort: "high",
        permissionMode: "auto" as const,
      }
      const parent = store.threads.create(project.id, "codex", profile)
      const child = store.threads.create(project.id, "codex", profile, {
        parentThreadId: parent.id,
      })
      const grandchild = store.threads.create(project.id, "codex", profile, {
        parentThreadId: child.id,
      })
      sequences.next(parent.id)
      sequences.next(child.id)
      sequences.next(grandchild.id)

      store.threads.delete(parent.id)

      expect(sequences.current(parent.id)).toBe(0)
      expect(sequences.current(child.id)).toBe(0)
      expect(sequences.current(grandchild.id)).toBe(0)
    } finally {
      store.close()
    }
  })

  it("does not index assistant text until its message settles", () => {
    const sequences = new ThreadSequences()
    const store = new Store(openDatabase(":memory:"), sequences)
    try {
      const project = store.projects.add("/tmp/example", "Example", "personal")
      const profile = {
        modelId: "gpt-5",
        effort: "high",
        permissionMode: "auto" as const,
      }
      const origin = store.threads.create(project.id, "codex", profile)
      const target = store.threads.create(project.id, "codex", profile)
      const turn = store.turns.begin(target.id, {
        text: "Start the task",
        references: [],
        attachments: [],
      })
      store.turns.appendDelta(turn.assistantMessageId, "visibleanswer")
      const nextSegment = store.turns.addSegment(target.id, turn.turnId, 2)
      store.turns.appendDelta(nextSegment.id, "unfinishedsecret")

      store.turns.closeSegment(turn.assistantMessageId)

      expect(
        store.threads.search(origin.id, "visibleanswer", "project", 10)
      ).toMatchObject([{ thread: { id: target.id } }])
      expect(
        store.threads.search(origin.id, "unfinishedsecret", "project", 10)
      ).toEqual([])

      store.turns.closeSegment(nextSegment.id)

      expect(
        store.threads.search(origin.id, "unfinishedsecret", "project", 10)
      ).toMatchObject([{ thread: { id: target.id } }])
    } finally {
      store.close()
    }
  })
})
