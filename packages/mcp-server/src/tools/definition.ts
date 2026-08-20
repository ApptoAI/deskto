import type { ToolAnnotations } from "@modelcontextprotocol/server"
import type { z } from "zod"

import type { RuntimeClient } from "../runtime-client.js"
import type { ArtifactRuntimeDependencies, SessionBinding } from "../types.js"

export type ToolContext = {
  client: RuntimeClient
  binding: SessionBinding
  artifactRuntime?: ArtifactRuntimeDependencies
}

export type ToolResult<Output> = {
  content: Array<{ type: "text"; text: string }>
  structuredContent: Output
}

export type ToolDefinition<
  Input extends z.ZodType = z.ZodType,
  Output extends z.ZodType = z.ZodType,
> = {
  name: string
  config: {
    title: string
    description: string
    inputSchema: Input
    outputSchema: Output
    annotations: ToolAnnotations
  }
  handler: (
    input: z.output<Input>,
    context: ToolContext
  ) => Promise<ToolResult<z.output<Output>>>
}

export const defineTool = <Input extends z.ZodType, Output extends z.ZodType>(
  definition: ToolDefinition<Input, Output>
): ToolDefinition<Input, Output> => definition
