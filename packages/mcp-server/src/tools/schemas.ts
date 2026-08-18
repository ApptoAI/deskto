import { z } from "zod"

import { RuntimeRequestError } from "../runtime-client.js"

export const threadSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  harnessId: z.string(),
  status: z.enum(["idle", "running", "waiting-approval", "failed"]),
  parentThreadId: z.string().nullable(),
  updatedAt: z.string(),
})

export type ThreadSummary = z.infer<typeof threadSummarySchema>

export const toolErrorSchema = z.object({
  code: z.string().nullable(),
  message: z.string(),
})

export type ToolError = z.infer<typeof toolErrorSchema>

export const caughtErrorSchema = z
  .instanceof(Error)
  .or(z.string().transform((message) => new Error(message)))
  .catch(new Error("Deskto Runtime request failed"))

export function toolError(error: Error): ToolError {
  return {
    code: error instanceof RuntimeRequestError ? error.code : null,
    message: error.message,
  }
}
