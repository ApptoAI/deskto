import type { RuntimeTransport } from "@deskto/protocol"

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

export type ArtifactRuntimeDependencies = {
  rootPath: string
  nodeExecutable: string
  nodeModulesPath: string
  pythonExecutable: string
  binaryPaths: string[]
  versions: {
    bundle: string
    artifactTool: string
    node: string
    python: string
  }
}

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
