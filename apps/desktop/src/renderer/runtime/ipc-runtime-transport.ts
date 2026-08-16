import type {
  RequestFor,
  RuntimeEvent,
  RuntimeMethod,
  RuntimeResponse,
  RuntimeTransport,
} from "@deskto/protocol"

import type { DesktopApi } from "../../shared/desktop-api.js"

/**
 * Carries the Runtime protocol over the preload bridge. It is the only place in
 * the renderer that knows the Runtime lives in the Electron main process.
 */
export class IpcRuntimeTransport implements RuntimeTransport {
  constructor(private readonly bridge: DesktopApi["runtime"]) {}

  request<M extends RuntimeMethod>(
    request: RequestFor<M>
  ): Promise<RuntimeResponse<M>> {
    return this.bridge.request(request)
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    return this.bridge.subscribe(listener)
  }
}
