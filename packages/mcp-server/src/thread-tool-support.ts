import {
  maximumThreadDepth,
  type Message,
  type Thread,
  type ThreadView,
} from "@deskto/protocol"
import { z } from "zod"

import { RuntimeClient } from "./runtime-client.js"
import type { SessionBinding } from "./types.js"

export const threadSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  harnessId: z.string(),
  status: z.enum(["idle", "running", "waiting-approval", "failed"]),
  parentThreadId: z.string().nullable(),
  updatedAt: z.string(),
})

export const caughtErrorSchema = z
  .instanceof(Error)
  .or(z.string().transform((message) => new Error(message)))
  .catch(new Error("Deskto Runtime request failed"))

export const textResult = <T extends object>(value: T) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  structuredContent: value,
})

export function summarize(thread: Thread) {
  return {
    id: thread.id,
    title: thread.title,
    harnessId: thread.harnessId,
    status: thread.status,
    parentThreadId: thread.parentThreadId,
    updatedAt: thread.updatedAt,
  }
}

export function titleFromPrompt(prompt: string): string {
  const firstLine = prompt.split("\n", 1)[0]?.trim() ?? ""
  return firstLine.slice(0, 120) || "Background task"
}

export function compactMessage(message: Message) {
  return {
    role: message.role,
    content: message.content.slice(0, 6_000),
    state: message.state,
    createdAt: message.createdAt,
  }
}

function latestTurnAssistant(
  view: ThreadView,
  state: "complete" | "error"
): Message | undefined {
  for (let index = view.messages.length - 1; index >= 0; index -= 1) {
    const message = view.messages[index]
    if (!message) continue
    if (message.role === "user") return undefined
    if (message.role === "assistant" && message.state !== "streaming") {
      return message.state === state ? message : undefined
    }
  }
  return undefined
}

export function finalAnswer(view: ThreadView): string | null {
  return latestTurnAssistant(view, "complete")?.content ?? null
}

export function latestTurnFailure(view: ThreadView): string | null {
  const failure = latestTurnAssistant(view, "error")
  return failure?.failure?.message ?? failure?.content ?? null
}

async function canControl(
  client: RuntimeClient,
  binding: SessionBinding,
  targetId: string
): Promise<boolean> {
  let currentId: string | null = targetId
  for (
    let depth = 0;
    currentId && depth <= maximumThreadDepth + 1;
    depth += 1
  ) {
    if (currentId === binding.threadId) return true
    currentId = (
      await client.request({
        method: "thread.get",
        params: { threadId: currentId },
      })
    ).thread.parentThreadId
  }
  return false
}

export async function requireControl(
  client: RuntimeClient,
  binding: SessionBinding,
  targetId: string
): Promise<void> {
  if (!(await canControl(client, binding, targetId))) {
    throw new Error(
      "You can only change the current task and its background tasks"
    )
  }
}

export async function waitForThreads(
  client: RuntimeClient,
  ids: string[],
  timeoutSeconds: number
): Promise<{ completed: boolean; threads: ThreadView[] }> {
  const read = () =>
    Promise.all(
      ids.map((threadId) =>
        client.request({ method: "thread.get", params: { threadId } })
      )
    )
  const isTerminal = (view: ThreadView) =>
    view.thread.status === "failed" ||
    (view.thread.status === "idle" && view.thread.lastUserMessageAt !== null)

  return new Promise((resolve, reject) => {
    let settled = false
    let reading = false
    let recheck = false
    let timer: ReturnType<typeof setTimeout> | undefined = undefined
    let unsubscribe: () => void = () => undefined
    const finish = (result: { completed: boolean; threads: ThreadView[] }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsubscribe()
      resolve(result)
    }
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsubscribe()
      reject(error)
    }
    const check = async () => {
      if (settled) return
      if (reading) {
        recheck = true
        return
      }
      reading = true
      try {
        const views = await read()
        if (views.every(isTerminal)) finish({ completed: true, threads: views })
      } catch (error) {
        fail(caughtErrorSchema.parse(error))
      } finally {
        reading = false
        if (recheck && !settled) {
          recheck = false
          void check()
        }
      }
    }
    unsubscribe = client.transport.subscribe((event) => {
      if (
        (event.type === "thread.changed" || event.type === "thread.delta") &&
        ids.includes(event.threadId)
      ) {
        void check()
      }
    })
    timer = setTimeout(() => {
      void read().then(
        (threads) => finish({ completed: threads.every(isTerminal), threads }),
        (error) => fail(caughtErrorSchema.parse(error))
      )
    }, timeoutSeconds * 1_000)
    void check()
  })
}
