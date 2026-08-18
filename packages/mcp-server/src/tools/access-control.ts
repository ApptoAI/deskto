import { maximumThreadDepth } from "@deskto/protocol"

import type { ToolContext } from "./definition.js"

async function canControl(
  { client, binding }: ToolContext,
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
  context: ToolContext,
  targetId: string
): Promise<void> {
  if (!(await canControl(context, targetId))) {
    throw new Error(
      "You can only change the current task and its background tasks"
    )
  }
}
