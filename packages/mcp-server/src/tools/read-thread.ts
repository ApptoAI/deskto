import { z } from "zod"

import { defineTool } from "./definition.js"
import {
  compactFinalAnswer,
  compactMessage,
  summarize,
  textResult,
} from "./format.js"
import { threadSummarySchema } from "./schemas.js"

export const readThreadTool = defineTool({
  name: "deskto_read_thread",
  config: {
    title: "Read a Deskto task",
    description:
      "Read the recent conversation and final answer from any local Deskto task.",
    inputSchema: z.object({
      threadId: z.string().min(1),
      messageLimit: z.number().int().min(1).max(30).default(12),
    }),
    outputSchema: z.object({
      thread: threadSummarySchema,
      messages: z.array(
        z.object({
          role: z.enum(["user", "assistant", "system"]),
          content: z.string(),
          state: z.enum(["streaming", "complete", "error"]),
          createdAt: z.string(),
        })
      ),
      finalAnswer: z.string().nullable(),
    }),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  handler: async ({ threadId, messageLimit }, { client }) => {
    const view = await client.request({
      method: "thread.get",
      params: { threadId },
    })
    return textResult({
      thread: summarize(view.thread),
      messages: view.messages.slice(-messageLimit).map(compactMessage),
      finalAnswer: compactFinalAnswer(view),
    })
  },
})
