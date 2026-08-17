import { maximumThreadChildren, type RequestFor } from "@deskto/protocol"
import { McpServer } from "@modelcontextprotocol/server"
import { z } from "zod"

import { RuntimeClient } from "./runtime-client.js"
import {
  caughtErrorSchema,
  compactMessage,
  finalAnswer,
  latestTurnFailure,
  requireControl,
  summarize,
  textResult,
  threadSummarySchema,
  titleFromPrompt,
  waitForThreads,
} from "./thread-tool-support.js"
import type { SessionBinding } from "./types.js"

export function createToolsServer(
  client: RuntimeClient,
  binding: SessionBinding
): McpServer {
  const server = new McpServer(
    { name: "deskto", version: "0.1.0" },
    {
      instructions:
        "Use these tools to split independent work into background tasks. Create a small bounded batch, continue useful work, then wait for or read the results. Search is read-only and can find any task stored on this computer. Write tools are limited to the current task tree.",
    }
  )

  server.registerTool(
    "deskto_context",
    {
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
    async () => {
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
      const workspace = workspaces.find(
        (item) => item.id === binding.workspaceId
      )
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
    }
  )

  server.registerTool(
    "deskto_create_threads",
    {
      title: "Create background tasks",
      description:
        "Create and immediately start up to eight independent background tasks in the current project.",
      inputSchema: z.object({
        tasks: z
          .array(
            z.object({
              prompt: z.string().trim().min(1).max(30_000),
              title: z.string().trim().min(1).max(160).optional(),
              harnessId: z.string().trim().min(1).optional(),
            })
          )
          .min(1)
          .max(maximumThreadChildren),
      }),
      outputSchema: z.object({
        threads: z.array(threadSummarySchema),
        errors: z.array(
          z.object({
            title: z.string(),
            harnessId: z.string(),
            threadId: z.string().nullable(),
            stage: z.enum(["create", "start"]),
            message: z.string(),
          })
        ),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ tasks }) => {
      const [origin, harnesses] = await Promise.all([
        client.request({
          method: "thread.get",
          params: { threadId: binding.threadId },
        }),
        client.request({ method: "harness.list", params: {} }),
      ])
      const available = new Set(
        harnesses
          .filter(
            (harness) =>
              harness.enabled && harness.availability.status === "available"
          )
          .map((harness) => harness.id)
      )
      for (const task of tasks) {
        const harnessId = task.harnessId ?? origin.thread.harnessId
        if (!available.has(harnessId)) {
          throw new Error(`Harness ${harnessId} is not installed or available`)
        }
      }

      const attempts = await Promise.allSettled(
        tasks.map(async (task) => {
          const harnessId = task.harnessId ?? origin.thread.harnessId
          const params: RequestFor<"thread.create">["params"] = {
            projectId: binding.projectId,
            harnessId,
            parentThreadId: binding.threadId,
            title: task.title ?? titleFromPrompt(task.prompt),
          }
          if (harnessId === origin.thread.harnessId) {
            params.executionProfile = origin.thread.executionProfile
          }
          const thread = await client.request({
            method: "thread.create",
            params,
          })
          try {
            const started = await client.request({
              method: "turn.start",
              params: { threadId: thread.id, prompt: task.prompt },
            })
            return {
              thread: started.thread,
              startError:
                started.thread.status === "failed"
                  ? new Error(
                      latestTurnFailure(started) ??
                        "The harness failed to start this task"
                    )
                  : undefined,
            }
          } catch (error) {
            return { thread, startError: caughtErrorSchema.parse(error) }
          }
        })
      )
      const threads: ReturnType<typeof summarize>[] = []
      const errors: Array<{
        title: string
        harnessId: string
        threadId: string | null
        stage: "create" | "start"
        message: string
      }> = []
      for (const [index, attempt] of attempts.entries()) {
        const task = tasks[index]
        if (!task) continue
        if (attempt.status === "fulfilled") {
          threads.push(summarize(attempt.value.thread))
          if (attempt.value.startError) {
            errors.push({
              title: attempt.value.thread.title,
              harnessId: attempt.value.thread.harnessId,
              threadId: attempt.value.thread.id,
              stage: "start",
              message: attempt.value.startError.message,
            })
          }
        } else {
          errors.push({
            title: task.title ?? titleFromPrompt(task.prompt),
            harnessId: task.harnessId ?? origin.thread.harnessId,
            threadId: null,
            stage: "create",
            message: caughtErrorSchema.parse(attempt.reason).message,
          })
        }
      }
      return textResult({ threads, errors })
    }
  )

  server.registerTool(
    "deskto_list_threads",
    {
      title: "List background tasks",
      description: "List direct background tasks created by the current task.",
      inputSchema: z.object({}),
      outputSchema: z.object({ threads: z.array(threadSummarySchema) }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      const view = await client.request({
        method: "thread.get",
        params: { threadId: binding.threadId },
      })
      return textResult({ threads: view.childThreads.map(summarize) })
    }
  )

  server.registerTool(
    "deskto_search_threads",
    {
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
    async ({ query, scope, limit }) => {
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
    }
  )

  server.registerTool(
    "deskto_read_thread",
    {
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
    async ({ threadId, messageLimit }) => {
      const view = await client.request({
        method: "thread.get",
        params: { threadId },
      })
      return textResult({
        thread: summarize(view.thread),
        messages: view.messages.slice(-messageLimit).map(compactMessage),
        finalAnswer: finalAnswer(view)?.slice(0, 12_000) ?? null,
      })
    }
  )

  server.registerTool(
    "deskto_wait_for_threads",
    {
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
    async ({ threadIds, timeoutSeconds }) => {
      const uniqueIds = [...new Set(threadIds)]
      await Promise.all(
        uniqueIds.map((threadId) => requireControl(client, binding, threadId))
      )
      const result = await waitForThreads(client, uniqueIds, timeoutSeconds)
      return textResult({
        completed: result.completed,
        threads: result.threads.map((view) => ({
          thread: summarize(view.thread),
          finalAnswer: finalAnswer(view)?.slice(0, 12_000) ?? null,
        })),
      })
    }
  )

  server.registerTool(
    "deskto_start_turn",
    {
      title: "Continue a background task",
      description:
        "Send another prompt to the current task or one of its background tasks.",
      inputSchema: z.object({
        threadId: z.string().min(1),
        prompt: z.string().trim().min(1).max(30_000),
      }),
      outputSchema: z.object({ thread: threadSummarySchema }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ threadId, prompt }) => {
      await requireControl(client, binding, threadId)
      const view = await client.request({
        method: "turn.start",
        params: { threadId, prompt },
      })
      return textResult({ thread: summarize(view.thread) })
    }
  )

  server.registerTool(
    "deskto_cancel_threads",
    {
      title: "Cancel background tasks",
      description: "Cancel active turns in selected background tasks.",
      inputSchema: z.object({
        threadIds: z.array(z.string().min(1)).min(1).max(maximumThreadChildren),
      }),
      outputSchema: z.object({ threads: z.array(threadSummarySchema) }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ threadIds }) => {
      const uniqueIds = [...new Set(threadIds)]
      await Promise.all(
        uniqueIds.map((threadId) => requireControl(client, binding, threadId))
      )
      const views = await Promise.all(
        uniqueIds.map((threadId) =>
          client.request({ method: "turn.cancel", params: { threadId } })
        )
      )
      return textResult({
        threads: views.map((view) => summarize(view.thread)),
      })
    }
  )

  return server
}
