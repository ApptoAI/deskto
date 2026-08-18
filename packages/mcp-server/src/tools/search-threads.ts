import { z } from "zod"

import { defineTool } from "./definition.js"
import { summarize, textResult } from "./format.js"
import { threadSummarySchema } from "./schemas.js"

export const searchThreadsTool = defineTool({
  name: "deskto_search_threads",
  config: {
    title: "Search Deskto tasks",
    description:
      "Full-text search across task titles and messages in this project, workspace, or all local workspaces.",
    inputSchema: z.object({
      query: z.string().trim().min(1).max(300),
      scope: z.enum(["project", "workspace", "all"]).default("workspace"),
      limit: z.number().int().min(1).max(20).default(10),
    }),
    outputSchema: z.object({
      results: z.array(
        z.object({
          thread: threadSummarySchema,
          projectName: z.string(),
          workspaceName: z.string(),
          excerpt: z.string(),
        })
      ),
    }),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  handler: async ({ query, scope, limit }, { client, binding }) => {
    const results = await client.request({
      method: "thread.search",
      params: {
        originThreadId: binding.threadId,
        query,
        scope,
        limit,
      },
    })
    return textResult({
      results: results.map((result) => ({
        thread: summarize(result.thread),
        projectName: result.projectName,
        workspaceName: result.workspaceName,
        excerpt: result.excerpt,
      })),
    })
  },
})
