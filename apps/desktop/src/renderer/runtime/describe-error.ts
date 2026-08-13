import { RuntimeClientError } from "@openappto/client"

export function describeError(error: unknown): string {
  if (error instanceof RuntimeClientError) return error.message
  if (error instanceof Error) return error.message
  return "The runtime did not explain what went wrong."
}
