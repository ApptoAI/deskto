# @deskto/client

A typed client for the Deskto Runtime. Any Surface (the desktop app today, web or mobile later) constructs one `RuntimeClient` around a transport and calls task-oriented methods instead of building protocol requests by hand.

## Why it exists

The Client sits on the user-facing side of the Client/Runtime boundary. It knows nothing about Node, SQLite, Electron, or provider SDKs. It only knows the `RuntimeTransport` interface from `@deskto/protocol`, so the same code works whether the Runtime lives in the Electron main process or, someday, behind HTTP and WebSocket.

## What it does

`RuntimeClient` wraps every protocol method in a named function:

- Harnesses: `listHarnesses()`, `setHarnessEnabled(harnessId, enabled)`, `refreshHarnesses()`
- Workspaces: `listWorkspaces()`, `createWorkspace(name, color, icon)`, `updateWorkspace(workspaceId, patch)`, `deleteWorkspace(workspaceId)`, `setWorkspacePack(workspaceId, packId, attached)`
- Selection: `getSelection()`, `setSelection(workspaceId, projectId?)`
- Packs: `listPacks()`, `createPack(name)`, `installPackFromFolder(path)`, `installPackFromZip(path)`, `linkPack(path)`, `unlinkPack(packId)`, `uninstallPack(packId)`
- Projects: `listProjects()`, `addProject(path, name, workspaceId)`, `moveProject(projectId, workspaceId)`
- Threads: `listThreads(projectId)`, `createThread(projectId, harnessId, executionProfile?)`, `configureThread(threadId, executionProfile)`, `getThread(threadId)`
- Turns and approvals: `startTurn(threadId, prompt)`, `cancelTurn(threadId)`, `resolveApproval(threadId, approvalId, decision)`
- Preferences: `getPreferences(workspaceId)`
- Settings: `getSettings()`, `updateSettings(entries)` — a null entry clears that override back to its default

Each call unwraps the protocol's `{ ok, data | error }` envelope. On failure it throws `RuntimeClientError`, which carries the protocol error `code` alongside the message.

`subscribe(listener)` forwards Runtime events (`thread.changed`, `thread.delta`, `harness.changed`, `settings.changed`, `workspace.changed`, `pack.changed`) and returns an unsubscribe function. Most events only signal that something changed and the Surface refetches state through queries. `thread.delta` carries the change itself: `applyThreadDelta(view, event)` folds it into a held `ThreadView` and returns `applied` with the next view, `stale` when the view already contains it, or `gap` when the view must be reloaded. The fold never guesses; anything it cannot place safely becomes a reload.

## Usage

```ts
import { RuntimeClient } from "@deskto/client"

const client = new RuntimeClient(transport)

const view = await client.startTurn(thread.id, prompt)

const unsubscribe = client.subscribe((event) => {
  if (event.type === "thread.changed") reloadThread(event.threadId)
})
```

The desktop app provides the client through React context (`RuntimeClientProvider` and `useRuntimeClient` in `apps/desktop`), with `IpcRuntimeTransport` as the transport over the Electron preload bridge.
