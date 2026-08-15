import type {
  RuntimeEvent,
  RuntimeRequest,
  RuntimeResponse,
} from "@openappto/protocol"

export type PickedProject = {
  path: string
  name: string
}

export interface DesktopApi {
  runtime: {
    request(request: RuntimeRequest): Promise<RuntimeResponse>
    subscribe(listener: (event: RuntimeEvent) => void): () => void
  }
  pickProject(): Promise<PickedProject | undefined>
  pickPack(): Promise<PickedProject | undefined>
  openExternal(url: string): Promise<void>
  /** Reveals a project folder in the system file manager. */
  openFolder(path: string): Promise<void>
}
