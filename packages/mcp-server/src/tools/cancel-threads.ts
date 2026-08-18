import { maximumThreadChildren } from "@deskto/protocol"
import { z } from "zod"

import { requireControl } from "./access-control.js"
import { defineTool } from "./definition.js"
import { summarize, textResult } from "./format.js"
import {
  threadSummarySchema,
  toolError,
  toolErrorSchema,
  type ThreadSummary,
} from "./schemas.js"
import { settleAll } from "./settle.js"

const cancelErrorSchema = toolErrorSchema.extend({ threadId: z.string() })

type CancelError = z.infer<typeof cancelErrorSchema>

export const cancelThreadsTool = defineTool({
  name: "deskto_cancel_threads",
  config: {
    title: "Cancel background tasks",
    description: "Cancel active turns in selected background tasks.",
    inputSchema: z.object({
      threadIds: z.array(z.string().min(1)).min(1).max(maximumThreadChildren),
    }),
    outputSchema: z.object({
      threads: z.array(threadSummarySchema),
      errors: z.array(cancelErrorSchema),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  handler: async ({ threadIds }, context) => {
    const uniqueIds = [...new Set(threadIds)]
    const attempts = await settleAll(uniqueIds, async (threadId) => {
      await requireControl(context, threadId)
      return context.client.request({
        method: "turn.cancel",
        params: { threadId },
      })
    })
    const threads: ThreadSummary[] = []
    const errors: CancelError[] = []
    for (const attempt of attempts) {
      if (attempt.error) {
        errors.push({ threadId: attempt.item, ...toolError(attempt.error) })
      } else {
        threads.push(summarize(attempt.value.thread))
      }
    }
    return textResult({ threads, errors })
  },
})
