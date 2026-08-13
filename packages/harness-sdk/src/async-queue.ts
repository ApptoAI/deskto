export class AsyncQueue<T> implements AsyncIterable<T> {
  readonly #values: T[] = []
  readonly #readers: Array<(value: IteratorResult<T>) => void> = []
  #closed = false

  push(value: T): void {
    if (this.#closed) return

    const reader = this.#readers.shift()
    if (reader) {
      reader({ done: false, value })
      return
    }

    this.#values.push(value)
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true

    for (const reader of this.#readers.splice(0)) {
      reader({ done: true, value: undefined })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.#values.shift()
        if (value !== undefined) {
          return Promise.resolve({ done: false, value })
        }

        if (this.#closed) {
          return Promise.resolve({ done: true, value: undefined })
        }

        return new Promise((resolve) => this.#readers.push(resolve))
      },
    }
  }
}
