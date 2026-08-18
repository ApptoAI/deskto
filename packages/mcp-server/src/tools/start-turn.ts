import { z } from "zod"

import { requireControl } from "./access-control.js"
import { defineTool } from "./definition.js"
import { latestTurnFailure, summarize, textResult } from "./format.js"
import { threadSummarySchema } from "./schemas.js"

export const startTurnTool = defineTool({
  name: "deskto_start_turn",
  config: {
    title: "Continue a background task",
    description:
      "Send another prompt to the current task or one of its background tasks.",
    inputSchema: z.object({
      threadId: z.string().min(1),
      prompt: z.string().trim().min(1).max(30_000),
    }),
    outputSchema: z.object({
      thread: threadSummarySchema,
      startError: z.string().nullable(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  handler: async ({ threadId, prompt }, context) => {
    await requireControl(context, threadId)
    const view = await context.client.request({
      method: "turn.start",
      params: { threadId, prompt },
    })
    return textResult({
      thread: summarize(view.thread),
      startError:
        view.thread.status === "failed"
          ? (latestTurnFailure(view) ?? "The harness failed to start this task")
          : null,
    })
  },
})
