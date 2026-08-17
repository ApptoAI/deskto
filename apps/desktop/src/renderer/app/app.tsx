import { RuntimeClient } from "@deskto/client"

import { StatusPanel } from "../components/status-panel.js"
import { IpcRuntimeTransport } from "../runtime/ipc-runtime-transport.js"
import { RuntimeClientProvider } from "../runtime/runtime-client-context.js"
import { SettingsProvider } from "../settings/settings-context.js"
import { ThemeSync } from "../settings/theme-sync.js"
import { Workbench } from "./workbench.js"

const bridge: typeof window.deskto | undefined = window.deskto
const client = bridge
  ? new RuntimeClient(new IpcRuntimeTransport(bridge.runtime))
  : null

export function App() {
  if (!client) {
    return (
      <div className="flex h-dvh w-full flex-col bg-background text-foreground">
        <div className="drag-region h-10 shrink-0" />
        <StatusPanel
          title="Deskto could not start"
          description="The desktop bridge did not load, so this window cannot reach the runtime. Quit Deskto and open it again."
          tone="danger"
        />
      </div>
    )
  }

  return (
    <RuntimeClientProvider client={client}>
      <SettingsProvider>
        <ThemeSync />
        <Workbench />
      </SettingsProvider>
    </RuntimeClientProvider>
  )
}
