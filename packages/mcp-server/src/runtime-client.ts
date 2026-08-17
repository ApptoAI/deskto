import type {
  RequestFor,
  RuntimeMethod,
  RuntimeResponses,
  RuntimeTransport,
} from "@deskto/protocol"

export class RuntimeRequestError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = "RuntimeRequestError"
  }
}

export class RuntimeClient {
  constructor(readonly transport: RuntimeTransport) {}

  async request<M extends RuntimeMethod>(
    request: RequestFor<M>
  ): Promise<RuntimeResponses[M]> {
    const response = await this.transport.request(request)
    if (!response.ok) {
      throw new RuntimeRequestError(response.error.code, response.error.message)
    }
    return response.data
  }
}
