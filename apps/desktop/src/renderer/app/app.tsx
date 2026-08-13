import { RuntimeClient } from "@openappto/client"

import { StatusPanel } from "../components/status-panel.js"
import { IpcRuntimeTransport } from "../runtime/ipc-runtime-transport.js"
import { RuntimeClientProvider } from "../runtime/runtime-client-context.js"
import { Workbench } from "./workbench.js"

const bridge: typeof window.appto | undefined = window.appto
const client = bridge
  ? new RuntimeClient(new IpcRuntimeTransport(bridge.runtime))
  : null

export function App() {
  if (!client) {
    return (
      <div className="flex h-dvh w-full flex-col bg-background text-foreground">
        <div className="drag-region h-10 shrink-0" />
        <StatusPanel
          title="Appto could not start"
          description="The desktop bridge did not load, so this window cannot reach the runtime. Quit Appto and open it again."
          tone="danger"
        />
      </div>
    )
  }

  return (
    <RuntimeClientProvider client={client}>
      <Workbench />
    </RuntimeClientProvider>
  )
}
