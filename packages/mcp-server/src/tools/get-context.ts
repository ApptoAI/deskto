import { z } from "zod"

import { defineTool } from "./definition.js"
import { summarize, textResult } from "./format.js"
import { threadSummarySchema } from "./schemas.js"

export const getContextTool = defineTool({
  name: "deskto_context",
  config: {
    title: "Get Deskto task context",
    description:
      "Show the current task, project, workspace, and available harnesses.",
    inputSchema: z.object({}),
    outputSchema: z.object({
      thread: threadSummarySchema,
      project: z.object({
        id: z.string(),
        name: z.string(),
        path: z.string(),
      }),
      workspace: z.object({ id: z.string(), name: z.string() }),
      harnesses: z.array(
        z.object({ id: z.string(), name: z.string(), available: z.boolean() })
      ),
    }),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  handler: async (_input, { client, binding }) => {
    const [view, projects, workspaces, harnesses] = await Promise.all([
      client.request({
        method: "thread.get",
        params: { threadId: binding.threadId },
      }),
      client.request({ method: "project.list", params: {} }),
      client.request({ method: "workspace.list", params: {} }),
      client.request({ method: "harness.list", params: {} }),
    ])
    const project = projects.find((item) => item.id === binding.projectId)
    const workspace = workspaces.find((item) => item.id === binding.workspaceId)
    if (!project || !workspace)
      throw new Error("The current task context no longer exists")
    return textResult({
      thread: summarize(view.thread),
      project: { id: project.id, name: project.name, path: project.path },
      workspace: { id: workspace.id, name: workspace.name },
      harnesses: harnesses.map((harness) => ({
        id: harness.id,
        name: harness.name,
        available:
          harness.enabled && harness.availability.status === "available",
      })),
    })
  },
})
