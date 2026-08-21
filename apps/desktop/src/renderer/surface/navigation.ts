export type SurfaceNavigationHost = {
  newTask: () => void
  openTask: (threadId: string) => void
  openProjects: () => void
  openSkills: () => void
  openSettings: () => void
  nextWorkspace: () => void
  previousWorkspace: () => void
}

export class SurfaceNavigationApi {
  #host: SurfaceNavigationHost | null = null

  register(host: SurfaceNavigationHost): () => void {
    if (this.#host) throw new Error("Surface navigation is already registered")
    this.#host = host
    return () => {
      if (this.#host === host) this.#host = null
    }
  }

  readonly newTask = (): void => {
    this.#requireHost().newTask()
  }

  readonly openTask = (threadId: string): void => {
    this.#requireHost().openTask(threadId)
  }

  readonly openProjects = (): void => {
    this.#requireHost().openProjects()
  }

  readonly openSkills = (): void => {
    this.#requireHost().openSkills()
  }

  readonly openSettings = (): void => {
    this.#requireHost().openSettings()
  }

  readonly nextWorkspace = (): void => {
    this.#requireHost().nextWorkspace()
  }

  readonly previousWorkspace = (): void => {
    this.#requireHost().previousWorkspace()
  }

  #requireHost(): SurfaceNavigationHost {
    if (!this.#host) throw new Error("Surface navigation is not registered")
    return this.#host
  }
}
