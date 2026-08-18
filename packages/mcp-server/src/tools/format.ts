import type { Message, Thread, ThreadView } from "@deskto/protocol"

import type { ThreadSummary } from "./schemas.js"

export const textResult = <T extends object>(value: T) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  structuredContent: value,
})

export function summarize(thread: Thread): ThreadSummary {
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

export function compactFinalAnswer(view: ThreadView): string | null {
  return finalAnswer(view)?.slice(0, 12_000) ?? null
}

export function latestTurnFailure(view: ThreadView): string | null {
  const failure = latestTurnAssistant(view, "error")
  return failure?.failure?.message ?? failure?.content ?? null
}
