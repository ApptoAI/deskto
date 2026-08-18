import { z } from "zod"

import { defineTool } from "./definition.js"
import { summarize, textResult } from "./format.js"
import { threadSummarySchema } from "./schemas.js"

export const listThreadsTool = defineTool({
  name: "deskto_list_threads",
  config: {
    title: "List background tasks",
    description: "List direct background tasks created by the current task.",
    inputSchema: z.object({}),
    outputSchema: z.object({ threads: z.array(threadSummarySchema) }),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  handler: async (_input, { client, binding }) => {
    const view = await client.request({
      method: "thread.get",
      params: { threadId: binding.threadId },
    })
    return textResult({ threads: view.childThreads.map(summarize) })
  },
})
