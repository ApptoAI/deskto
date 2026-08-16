import { z } from "zod"

export class RuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = "RuntimeError"
  }
}

export function createErrorMessageSchema(fallback: string) {
  return z
    .instanceof(Error)
    .transform((error) => error.message)
    .catch(fallback)
}

export const runtimeErrorMessageSchema = createErrorMessageSchema(
  "Unknown runtime error"
)
