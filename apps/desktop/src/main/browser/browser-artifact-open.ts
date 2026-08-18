export type BrowserArtifactOpenRequest = {
  threadId: string
  sequence: number
}

/** Keeps overlapping Artifact lookups latest-wins for each Task. */
export class BrowserArtifactOpenRequests {
  readonly #latestByThread = new Map<string, number>()
  #nextSequence = 0

  begin(threadId: string): BrowserArtifactOpenRequest {
    const request = { threadId, sequence: ++this.#nextSequence }
    this.#latestByThread.set(threadId, request.sequence)
    return request
  }

  isCurrent(request: BrowserArtifactOpenRequest): boolean {
    return this.#latestByThread.get(request.threadId) === request.sequence
  }

  invalidate(threadId: string): void {
    this.#latestByThread.set(threadId, ++this.#nextSequence)
  }

  finish(request: BrowserArtifactOpenRequest): void {
    if (this.isCurrent(request)) this.#latestByThread.delete(request.threadId)
  }

  clear(threadId: string): void {
    this.#latestByThread.delete(threadId)
  }
}
