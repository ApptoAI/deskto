export type SurfaceCommand = {
  id: string
  title: string
  description?: string
  enabled?: () => boolean
  run: () => void | Promise<void>
}

export const surfaceCommandIds = {
  newTask: "app.new-task",
  nextWorkspace: "workspace.next",
  previousWorkspace: "workspace.previous",
} as const

/** Renderer-local user intents shared by buttons, menus, and keybindings. */
export class SurfaceCommandRegistry {
  readonly #commands = new Map<string, SurfaceCommand>()

  register(command: SurfaceCommand): () => void {
    if (command.id.trim() === "") {
      throw new Error("Surface command IDs cannot be empty")
    }
    if (this.#commands.has(command.id)) {
      throw new Error(`Surface command ${command.id} is already registered`)
    }

    this.#commands.set(command.id, command)

    return () => {
      if (this.#commands.get(command.id) !== command) return
      this.#commands.delete(command.id)
    }
  }

  async execute(id: string): Promise<void> {
    const command = this.#commands.get(id)
    if (!command) throw new Error(`Surface command ${id} is not registered`)
    if (command.enabled && !command.enabled()) return
    await command.run()
  }

  list(): SurfaceCommand[] {
    return [...this.#commands.values()]
  }
}
