import type {
  RuntimeRequest,
  RuntimeTransport,
  ThreadView,
} from "@deskto/protocol"

import type { ArtifactRuntimeDependencies, SessionBinding } from "./types.js"

const now = "2026-08-17T10:00:00.000Z"

export const parentThreadView: ThreadView = {
  thread: {
    id: "thread-1",
    projectId: "project-1",
    parentThreadId: null,
    title: "Ship orchestration",
    harnessId: "codex",
    status: "running",
    executionProfile: {
      modelId: "gpt-5",
      effort: "high",
      permissionMode: "auto",
    },
    lastUserMessageAt: now,
    lastTurnCompletedAt: null,
    failedAt: null,
    lastVisitedAt: now,
    pinnedAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    doneOverride: null,
    doneAt: null,
    createdAt: now,
    updatedAt: now,
  },
  childThreads: [],
  messages: [],
  activities: [],
  seq: 0,
}

export function childThreadView(
  status: ThreadView["thread"]["status"],
  lastUserMessageAt: string | null
): ThreadView {
  return {
    thread: {
      ...parentThreadView.thread,
      id: "child-1",
      parentThreadId: "thread-1",
      title: "Background task",
      status,
      lastUserMessageAt,
      lastTurnCompletedAt: status === "idle" ? now : null,
      failedAt: status === "failed" ? now : null,
      lastVisitedAt: null,
    },
    childThreads: [],
    messages: [],
    activities: [],
    seq: 0,
  }
}

export const testBinding: SessionBinding = {
  threadId: "thread-1",
  turnId: "turn-1",
  projectId: "project-1",
  workspaceId: "personal",
  expiresAt: Number.MAX_SAFE_INTEGER,
}

export const artifactRuntime: ArtifactRuntimeDependencies = {
  rootPath: "/runtime",
  nodeExecutable: "/runtime/node/bin/node",
  nodeModulesPath: "/runtime/node/node_modules",
  pythonExecutable: "/runtime/python/bin/python3",
  binaryPaths: ["/runtime/bin"],
  versions: {
    bundle: "26.805.11740",
    artifactTool: "2.8.39",
    node: "v24.14.0",
    python: "3.12.13",
  },
}

export function fakeRuntime(
  options: { failTurnStart?: boolean; failCancelThreadId?: string } = {}
): RuntimeTransport {
  let childCount = 0
  const childView = (
    id: string,
    status: ThreadView["thread"]["status"] = "running"
  ): ThreadView => ({
    ...parentThreadView,
    thread: {
      ...parentThreadView.thread,
      id,
      parentThreadId: "thread-1",
      title: `Task ${id}`,
      status,
      lastUserMessageAt: now,
    },
  })
  // SAFETY: the switch returns the matching Runtime response shape for every
  // method this MCP server test calls. Unexpected methods throw.
  const request = (async (request: RuntimeRequest) => {
    switch (request.method) {
      case "thread.get": {
        const threadId = request.params.threadId
        return {
          ok: true,
          data:
            threadId === "thread-1" ? parentThreadView : childView(threadId),
        }
      }
      case "project.list":
        return {
          ok: true,
          data: [
            {
              id: "project-1",
              workspaceId: "personal",
              name: "Deskto",
              path: "/tmp/deskto",
              createdAt: now,
              updatedAt: now,
            },
          ],
        }
      case "workspace.list":
        return {
          ok: true,
          data: [
            {
              id: "personal",
              name: "Personal",
              color: "blue",
              icon: "house",
              sortOrder: 0,
              createdAt: now,
              updatedAt: now,
            },
          ],
        }
      case "harness.list":
        return {
          ok: true,
          data: [
            {
              id: "codex",
              name: "Codex",
              enabled: true,
              availability: { status: "available" as const },
              checkedAt: now,
              models: [],
            },
          ],
        }
      case "thread.create": {
        childCount += 1
        return {
          ok: true,
          data: {
            ...parentThreadView.thread,
            id: `child-${childCount}`,
            parentThreadId: "thread-1",
            title: request.params.title ?? "Background task",
            harnessId: request.params.harnessId,
            status: "idle" as const,
            lastUserMessageAt: null,
          },
        }
      }
      case "turn.start": {
        if (!options.failTurnStart) {
          return {
            ok: true,
            data: childView(request.params.threadId),
          }
        }
        return {
          ok: true,
          data: {
            ...childView(request.params.threadId, "failed"),
            thread: {
              ...parentThreadView.thread,
              id: request.params.threadId,
              parentThreadId: "thread-1",
              title: "Check startup",
              status: "failed" as const,
              failedAt: now,
            },
            messages: [
              {
                id: "user-1",
                threadId: request.params.threadId,
                role: "user" as const,
                content: "Check startup",
                state: "complete" as const,
                createdAt: now,
              },
              {
                id: "assistant-1",
                threadId: request.params.threadId,
                role: "assistant" as const,
                content: "Harness executable is unavailable",
                state: "error" as const,
                failure: {
                  kind: "error" as const,
                  message: "Harness executable is unavailable",
                },
                createdAt: now,
              },
            ],
          },
        }
      }
      case "turn.cancel": {
        if (request.params.threadId === options.failCancelThreadId) {
          return {
            ok: false,
            error: { code: "turn-not-active", message: "Task is not running" },
          }
        }
        return {
          ok: true,
          data: childView(request.params.threadId, "idle"),
        }
      }
      default:
        throw new Error(`Unexpected method ${request.method}`)
    }
  }) as RuntimeTransport["request"]
  return {
    request,
    subscribe: () => () => undefined,
  }
}
