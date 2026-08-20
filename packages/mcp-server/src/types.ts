import type { RuntimeTransport } from "@deskto/protocol"
import { z } from "zod"

export type McpSessionContext = {
  threadId: string
  turnId: string
  projectId: string
  workspaceId: string
}

export type DesktoMcpConnection = {
  id: string
  name: string
  url: string
  authorizationToken: string
  required: boolean
}

export const artifactRuntimeDependenciesSchema = z.object({
  rootPath: z.string(),
  nodeExecutable: z.string(),
  nodeModulesPath: z.string(),
  pythonExecutable: z.string(),
  binaryPaths: z.array(z.string()),
  versions: z.object({
    bundle: z.string(),
    artifactTool: z.string(),
    node: z.string(),
    python: z.string(),
  }),
})

export type ArtifactRuntimeDependencies = z.infer<
  typeof artifactRuntimeDependenciesSchema
>

export type DesktoMcpServerOptions = {
  runtime: RuntimeTransport
  artifactRuntime?: ArtifactRuntimeDependencies
  port?: number
}

export interface DesktoMcpServer {
  readonly url: string
  connectionFor(context: McpSessionContext): DesktoMcpConnection
  revokeTurn(turnId: string): void
  close(): Promise<void>
}

export type SessionBinding = McpSessionContext & {
  expiresAt: number
}
