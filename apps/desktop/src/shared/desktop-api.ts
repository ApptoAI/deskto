import type {
  RuntimeEvent,
  RuntimeRequest,
  RuntimeResponse,
} from "@openappto/protocol"

export type PickedWorkspace = {
  path: string
  name: string
}

export interface DesktopApi {
  runtime: {
    request(request: RuntimeRequest): Promise<RuntimeResponse>
    subscribe(listener: (event: RuntimeEvent) => void): () => void
  }
  pickWorkspace(): Promise<PickedWorkspace | undefined>
  openExternal(url: string): Promise<void>
}
