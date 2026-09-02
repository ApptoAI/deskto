type PendingCreation<T> = {
  sequence: number
  promise: Promise<T>
}

/** Coalesces tab lookups and prevents a cancelled lookup from creating a tab. */
export class BrowserTabCreations<T> {
  readonly #pending = new Map<string, PendingCreation<T>>()
  readonly #latest = new Map<string, number>()
  #nextSequence = 0

  run<Input>(
    threadId: string,
    lookup: () => Promise<Input>,
    create: (input: Input) => T
  ): Promise<T> {
    const existing = this.#pending.get(threadId)
    if (existing) return existing.promise
    const sequence = ++this.#nextSequence
    this.#latest.set(threadId, sequence)
    const promise = Promise.resolve()
      .then(lookup)
      .then((input) => {
        if (this.#latest.get(threadId) !== sequence) {
          throw new Error("The task browser closed before it opened")
        }
        return create(input)
      })
      .finally(() => {
        if (this.#pending.get(threadId)?.sequence === sequence) {
          this.#pending.delete(threadId)
        }
        if (this.#latest.get(threadId) === sequence) {
          this.#latest.delete(threadId)
        }
      })
    this.#pending.set(threadId, { sequence, promise })
    return promise
  }

  cancel(threadId: string): void {
    this.#latest.set(threadId, ++this.#nextSequence)
    this.#pending.delete(threadId)
  }

  cancelAll(): string[] {
    const threadIds = [...this.#pending.keys()]
    for (const threadId of threadIds) this.cancel(threadId)
    return threadIds
  }
}
