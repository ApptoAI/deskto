import { McpServer, type ToolCallback } from "@modelcontextprotocol/server"
import type { z } from "zod"

import type { RuntimeClient } from "../runtime-client.js"
import type { SessionBinding } from "../types.js"
import { cancelThreadsTool } from "./cancel-threads.js"
import { createThreadsTool } from "./create-threads.js"
import type { ToolContext, ToolDefinition } from "./definition.js"
import { getContextTool } from "./get-context.js"
import { listThreadsTool } from "./list-threads.js"
import { readThreadTool } from "./read-thread.js"
import { searchThreadsTool } from "./search-threads.js"
import { startTurnTool } from "./start-turn.js"
import { waitForThreadsTool } from "./wait-for-threads.js"

const instructions =
  "Use these tools to split independent work into background tasks. Create a small bounded batch, continue useful work, then wait for or read the results. Search is read-only and can find any task stored on this computer. Write tools are limited to the current task tree."

function register<Input extends z.ZodType, Output extends z.ZodType>(
  server: McpServer,
  context: ToolContext,
  tool: ToolDefinition<Input, Output>
): void {
  const callback = (input: z.output<Input>) => tool.handler(input, context)
  // SAFETY: the SDK types the callback through a conditional on the schema
  // generic, which TypeScript cannot unify with z.output for an unresolved
  // type parameter. The input really is the parsed output of tool.config's
  // inputSchema, so the shapes match.
  server.registerTool(tool.name, tool.config, callback as ToolCallback<Input>)
}

export function createToolsServer(
  client: RuntimeClient,
  binding: SessionBinding
): McpServer {
  const server = new McpServer(
    { name: "deskto", version: "0.1.0" },
    { instructions }
  )
  const context: ToolContext = { client, binding }
  register(server, context, getContextTool)
  register(server, context, createThreadsTool)
  register(server, context, listThreadsTool)
  register(server, context, searchThreadsTool)
  register(server, context, readThreadTool)
  register(server, context, waitForThreadsTool)
  register(server, context, startTurnTool)
  register(server, context, cancelThreadsTool)
  return server
}
