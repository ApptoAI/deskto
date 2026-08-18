import { maximumThreadChildren, type RequestFor } from "@deskto/protocol"
import { z } from "zod"

import { defineTool } from "./definition.js"
import {
  latestTurnFailure,
  summarize,
  textResult,
  titleFromPrompt,
} from "./format.js"
import {
  caughtErrorSchema,
  threadSummarySchema,
  toolError,
  toolErrorSchema,
  type ThreadSummary,
} from "./schemas.js"
import { settleAll } from "./settle.js"

const createErrorSchema = toolErrorSchema.extend({
  title: z.string(),
  harnessId: z.string(),
  threadId: z.string().nullable(),
  stage: z.enum(["create", "start"]),
})

type CreateError = z.infer<typeof createErrorSchema>

export const createThreadsTool = defineTool({
  name: "deskto_create_threads",
  config: {
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
      errors: z.array(createErrorSchema),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  handler: async ({ tasks }, { client, binding }) => {
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
    const attempts = await settleAll(tasks, async (task) => {
      const harnessId = task.harnessId ?? origin.thread.harnessId
      if (!available.has(harnessId)) {
        throw new Error(`Harness ${harnessId} is not installed or available`)
      }
      const params: RequestFor<"thread.create">["params"] = {
        projectId: binding.projectId,
        harnessId,
        parentThreadId: binding.threadId,
        title: task.title ?? titleFromPrompt(task.prompt),
      }
      if (harnessId === origin.thread.harnessId) {
        params.executionProfile = origin.thread.executionProfile
      }
      const thread = await client.request({ method: "thread.create", params })
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
    const threads: ThreadSummary[] = []
    const errors: CreateError[] = []
    for (const attempt of attempts) {
      if (attempt.error) {
        errors.push({
          title: attempt.item.title ?? titleFromPrompt(attempt.item.prompt),
          harnessId: attempt.item.harnessId ?? origin.thread.harnessId,
          threadId: null,
          stage: "create",
          ...toolError(attempt.error),
        })
        continue
      }
      threads.push(summarize(attempt.value.thread))
      if (attempt.value.startError) {
        errors.push({
          title: attempt.value.thread.title,
          harnessId: attempt.value.thread.harnessId,
          threadId: attempt.value.thread.id,
          stage: "start",
          ...toolError(attempt.value.startError),
        })
      }
    }
    return textResult({ threads, errors })
  },
})
