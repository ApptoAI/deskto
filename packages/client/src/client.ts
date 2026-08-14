import type {
  RequestFor,
  RuntimeEvent,
  RuntimeMethod,
  RuntimeResponses,
  RuntimeTransport,
} from "@openappto/protocol"

export class RuntimeClientError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = "RuntimeClientError"
  }
}

export class RuntimeClient {
  constructor(private readonly transport: RuntimeTransport) {}

  async request<M extends RuntimeMethod>(
    request: RequestFor<M>
  ): Promise<RuntimeResponses[M]> {
    const response = await this.transport.request(request)
    if (!response.ok)
      throw new RuntimeClientError(response.error.code, response.error.message)
    return response.data
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    return this.transport.subscribe(listener)
  }

  listHarnesses() {
    return this.request({ method: "harness.list", params: {} })
  }

  setHarnessEnabled(harnessId: string, enabled: boolean) {
    return this.request({
      method: "harness.setEnabled",
      params: { harnessId, enabled },
    })
  }

  refreshHarnesses() {
    return this.request({ method: "harness.refresh", params: {} })
  }

  getPreferences() {
    return this.request({ method: "preferences.get", params: {} })
  }

  getSettings() {
    return this.request({ method: "settings.get", params: {} })
  }

  /** Applies setting overrides; a null entry clears one back to its default. */
  updateSettings(entries: Record<string, unknown>) {
    return this.request({ method: "settings.update", params: { entries } })
  }

  listProjects() {
    return this.request({ method: "project.list", params: {} })
  }

  addProject(path: string, name: string) {
    return this.request({ method: "project.add", params: { path, name } })
  }

  listThreads(projectId: string) {
    return this.request({ method: "thread.list", params: { projectId } })
  }

  createThread(
    projectId: string,
    harnessId: string,
    executionProfile?: RequestFor<"thread.create">["params"]["executionProfile"]
  ) {
    return this.request({
      method: "thread.create",
      params: { projectId, harnessId, executionProfile },
    })
  }

  configureThread(
    threadId: string,
    executionProfile: RequestFor<"thread.configure">["params"]["executionProfile"]
  ) {
    return this.request({
      method: "thread.configure",
      params: { threadId, executionProfile },
    })
  }

  getThread(threadId: string) {
    return this.request({ method: "thread.get", params: { threadId } })
  }

  startTurn(threadId: string, prompt: string) {
    return this.request({ method: "turn.start", params: { threadId, prompt } })
  }

  cancelTurn(threadId: string) {
    return this.request({ method: "turn.cancel", params: { threadId } })
  }

  resolveApproval(
    threadId: string,
    approvalId: string,
    decision: "approve" | "deny"
  ) {
    return this.request({
      method: "approval.resolve",
      params: { threadId, approvalId, decision },
    })
  }
}
