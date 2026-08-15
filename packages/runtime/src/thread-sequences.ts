/**
 * Per-thread delta cursor. Every emitted `thread.delta` takes the next value;
 * every ThreadView carries the current one, so a client can tell whether a
 * delta extends the view it holds or whether it must reload. The counter is
 * process-local on purpose: after a Runtime restart clients reload anyway
 * (ADR 0004), which re-baselines them.
 */
export class ThreadSequences {
  readonly #byThread = new Map<string, number>()

  current(threadId: string): number {
    return this.#byThread.get(threadId) ?? 0
  }

  next(threadId: string): number {
    const next = this.current(threadId) + 1
    this.#byThread.set(threadId, next)
    return next
  }

  /** Drops a deleted Thread's cursor; nothing will ever ask for it again. */
  forget(threadId: string): void {
    this.#byThread.delete(threadId)
  }
}
