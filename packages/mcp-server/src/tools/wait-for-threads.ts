import { maximumThreadChildren } from "@deskto/protocol"
import { z } from "zod"

import { requireControl } from "./access-control.js"
import { defineTool } from "./definition.js"
import { compactFinalAnswer, summarize, textResult } from "./format.js"
import { threadSummarySchema } from "./schemas.js"
import { waitForThreads } from "./wait.js"

export const waitForThreadsTool = defineTool({
  name: "deskto_wait_for_threads",
  config: {
    title: "Wait for background tasks",
    description:
      "Wait until selected background tasks finish, fail, or reach the timeout. A timeout returns current state and can be called again.",
    inputSchema: z.object({
      threadIds: z.array(z.string().min(1)).min(1).max(maximumThreadChildren),
      timeoutSeconds: z.number().int().min(1).max(55).default(30),
    }),
    outputSchema: z.object({
      completed: z.boolean(),
      threads: z.array(
        z.object({
          thread: threadSummarySchema,
          finalAnswer: z.string().nullable(),
        })
      ),
    }),
    annotations: { readOnlyHint: true },
  },
  handler: async ({ threadIds, timeoutSeconds }, context) => {
    const uniqueIds = [...new Set(threadIds)]
    await Promise.all(
      uniqueIds.map((threadId) => requireControl(context, threadId))
    )
    const result = await waitForThreads(
      context.client,
      uniqueIds,
      timeoutSeconds
    )
    return textResult({
      completed: result.completed,
      threads: result.threads.map((view) => ({
        thread: summarize(view.thread),
        finalAnswer: compactFinalAnswer(view),
      })),
    })
  },
})
