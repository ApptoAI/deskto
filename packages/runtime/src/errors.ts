export class RuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = "RuntimeError"
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown runtime error"
}
