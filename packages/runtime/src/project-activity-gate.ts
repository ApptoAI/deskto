import { RuntimeError } from "./errors.js"

/** Keeps project relocation and turn startup mutually exclusive in this Runtime. */
export class ProjectActivityGate {
  readonly #activeTurns = new Map<string, number>()
  readonly #relocating = new Set<string>()

  beginTurn(projectId: string): () => void {
    if (this.#relocating.has(projectId)) {
      throw new RuntimeError(
        "project-moving",
        "Wait for this project to finish moving before starting a task"
      )
    }
    this.#activeTurns.set(
      projectId,
      (this.#activeTurns.get(projectId) ?? 0) + 1
    )
    return once(() => {
      const remaining = (this.#activeTurns.get(projectId) ?? 1) - 1
      if (remaining === 0) this.#activeTurns.delete(projectId)
      else this.#activeTurns.set(projectId, remaining)
    })
  }

  beginRelocation(projectId: string): () => void {
    if (
      this.#relocating.has(projectId) ||
      (this.#activeTurns.get(projectId) ?? 0) > 0
    ) {
      throw new RuntimeError(
        "project-active",
        "Wait for active tasks before moving this project"
      )
    }
    this.#relocating.add(projectId)
    return once(() => this.#relocating.delete(projectId))
  }
}

function once(action: () => void): () => void {
  let called = false
  return () => {
    if (called) return
    called = true
    action()
  }
}
