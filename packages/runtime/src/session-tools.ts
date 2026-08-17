import type { SessionMcpServer } from "@deskto/harness-sdk"

export type SessionToolInput = {
  harnessId: string
  threadId: string
  turnId: string
  projectId: string
  workspaceId: string
  projectPath: string
}

export interface SessionToolLease {
  readonly mcpServers: SessionMcpServer[]
  close(): Promise<void>
}

/** Opens app-owned tools for one Turn without exposing provider details. */
export interface SessionToolProvider {
  open(
    input: SessionToolInput,
    signal: AbortSignal
  ): Promise<SessionToolLease | undefined>
}

export class SessionToolLeases implements SessionToolLease {
  readonly mcpServers: SessionMcpServer[]
  #closed = false

  private constructor(private readonly leases: SessionToolLease[]) {
    const servers = leases.flatMap((lease) => lease.mcpServers)
    const ids = new Set<string>()
    for (const server of servers) {
      if (ids.has(server.id)) {
        throw new Error(`Session tool server id is duplicated: ${server.id}`)
      }
      ids.add(server.id)
    }
    this.mcpServers = servers
  }

  static async open(
    providers: readonly SessionToolProvider[],
    input: SessionToolInput,
    signal: AbortSignal
  ): Promise<SessionToolLeases> {
    const leases: SessionToolLease[] = []
    try {
      for (const provider of providers) {
        if (signal.aborted) {
          throw new Error("Session tool setup was cancelled")
        }
        const lease = await provider.open(input, signal)
        if (signal.aborted) {
          await lease?.close()
          throw new Error("Session tool setup was cancelled")
        }
        if (lease) leases.push(lease)
      }
      return new SessionToolLeases(leases)
    } catch (error) {
      await Promise.allSettled(leases.map((lease) => lease.close()))
      throw error
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    await Promise.allSettled(this.leases.map((lease) => lease.close()))
  }
}
