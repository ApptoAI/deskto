import { RuntimeClient } from "@deskto/client"

import { createBrowserDesktopBridge } from "../runtime/browser-desktop-bridge.js"
import { StatusPanel } from "../components/status-panel.js"
import { IpcRuntimeTransport } from "../runtime/ipc-runtime-transport.js"
import { RuntimeClientProvider } from "../runtime/runtime-client-context.js"
import { SettingsProvider } from "../settings/settings-context.js"
import { SurfaceProvider } from "../surface/surface-context.js"
import { UpdatesProvider } from "../updates/updates-context.js"
import {
  InterfaceSizeSync,
  OnboardingCompletedSync,
  ThemeSync,
  WorkspaceLayoutSync,
} from "../settings/theme-sync.js"
import { Workbench } from "./workbench.js"

// The preload bridge exists only inside Electron. In a dev browser tab the
// HTTP bridge stands in; in a packaged build nothing sets it up, so the
// status panel below is still the correct answer.
const bridge: typeof window.deskto | undefined =
  window.deskto ??
  (import.meta.env.DEV && !window.location.protocol.startsWith("file")
    ? (window.deskto = createBrowserDesktopBridge())
    : undefined)
const client = bridge
  ? new RuntimeClient(new IpcRuntimeTransport(bridge.runtime))
  : null

export function App() {
  if (!client) {
    return (
      <div className="flex h-full w-full flex-col text-foreground glass-window">
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
      <SurfaceProvider>
        <SettingsProvider>
          <UpdatesProvider>
            <ThemeSync />
            <InterfaceSizeSync />
            <WorkspaceLayoutSync />
            <OnboardingCompletedSync />
            <Workbench />
          </UpdatesProvider>
        </SettingsProvider>
      </SurfaceProvider>
    </RuntimeClientProvider>
  )
}
