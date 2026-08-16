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
}
