import type {
  RequestFor,
  RuntimeEvent,
  RuntimeMethod,
  RuntimeResponse,
} from "@deskto/protocol"

export type PickedProject = {
  path: string
  name: string
}

/**
 * How a Surface names a result for a file action. The path stays in the
 * Runtime, so the renderer cannot ask the shell to touch an arbitrary file.
 */
export type ResultRef = {
  threadId: string
  artifactId: string
}

export interface DesktopApi {
  runtime: {
    request<M extends RuntimeMethod>(
      request: RequestFor<M>
    ): Promise<RuntimeResponse<M>>
    subscribe(listener: (event: RuntimeEvent) => void): () => void
  }
  pickProject(): Promise<PickedProject | undefined>
  pickPack(): Promise<PickedProject | undefined>
  openExternal(url: string): Promise<void>
  /** Reveals a project folder in the system file manager. */
  openFolder(path: string): Promise<void>
  /** Hands a result to the application that owns its format. */
  openFile(result: ResultRef): Promise<void>
  /** Selects a result in the system file manager. */
  revealFile(result: ResultRef): Promise<void>
  /** Saves a result somewhere else; false when the user cancelled. */
  saveFileCopy(result: ResultRef, suggestedName: string): Promise<boolean>
}
