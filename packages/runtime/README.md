# @openappto/runtime

The application service behind Appto. The Runtime owns workspaces, threads, turns, SQLite persistence, and the Harness sessions that do the actual work. It is a headless library: the Electron main process embeds it today, and a hosted server could embed the same code later.

## What it does

`createRuntime(options)` returns a `Runtime` that implements the `RuntimeTransport` interface from `@openappto/protocol`. Hosts hand it a database path and a list of harness adapters; clients talk to it through `request()` and `subscribe()`.

Internally the Runtime is four collaborators:

- The request router dispatches the 13 protocol methods (`workspace.add`, `thread.create`, `turn.start`, `approval.resolve`, and so on) and wraps results in the protocol's `{ ok, data | error }` envelope.
- The harness registry tracks the installed adapters, probes their availability on a timer (every 5 minutes by default), persists which ones the user enabled, and resolves execution profiles against each harness's model catalog.
- The turn coordinator runs a turn: it persists the user message first, starts a harness session, then consumes the session's event stream and turns it into stored messages, activities, and approvals, emitting `thread.changed` so open views refetch.
- The store persists everything in SQLite through Node's built-in `node:sqlite`, with WAL mode and migrations versioned by `PRAGMA user_version`. On startup, `recoverInterrupted()` marks turns that were running when the process died as failed, so the app never reopens into a phantom "running" state.

## Harness adapters

Two adapters ship in `src/harnesses/`, both implementing the `HarnessAdapterFactory` contract from `@openappto/harness-sdk`:

- `ClaudeAdapter` drives Claude Code through `@anthropic-ai/claude-agent-sdk`. It streams partial messages as `message.delta`, maps tool use to activities, routes permission checks through `canUseTool` so they surface as approvals, and resumes sessions via the stored provider session id.
- `CodexAdapter` spawns `codex app-server` and speaks JSON-RPC over JSONL. It maps item events to activities, forwards command and file-change approval requests, and cancels with `turn/interrupt`.

Provider types stay inside their adapter. By the time anything reaches the Client it is a `HarnessEvent`, then a protocol record.

## Embedding

```ts
import { createRuntime, ClaudeAdapter, CodexAdapter } from "@openappto/runtime"

const runtime = createRuntime({
  databasePath: join(userDataDir, "appto.sqlite"),
  harnesses: [new ClaudeAdapter(), new CodexAdapter()],
})
```

`RuntimeOptions` also accepts `harnessRefreshMs` and a `probeGate` promise, which delays availability probes until the host is ready (the desktop app resolves it after rebuilding PATH from the login shell). Call `runtime.close()` on shutdown.

Tests run with `pnpm --filter @openappto/runtime test` (vitest), using `ScriptedHarness` from the harness SDK instead of real providers.
