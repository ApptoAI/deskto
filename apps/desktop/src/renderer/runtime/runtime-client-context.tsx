import { createContext, useContext, type ReactNode } from "react"
import type { RuntimeClient } from "@deskto/client"

const RuntimeClientContext = createContext<RuntimeClient | null>(null)

export function RuntimeClientProvider({
  client,
  children,
}: {
  client: RuntimeClient
  children: ReactNode
}) {
  return <RuntimeClientContext value={client}>{children}</RuntimeClientContext>
}

export function useRuntimeClient(): RuntimeClient {
  const client = useContext(RuntimeClientContext)
  if (!client)
    throw new Error(
      "useRuntimeClient must be used inside RuntimeClientProvider."
    )
  return client
}
