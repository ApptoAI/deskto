# @openappto/runtime

The application service behind Appto. The Runtime owns workspaces, projects, packs, threads, turns, SQLite persistence, and the Harness sessions that do the actual work. It is a headless library: the Electron main process embeds it today, and a hosted server could embed the same code later.

## What it does

`createRuntime(options)` returns a `Runtime` that implements the `RuntimeTransport` interface from `@openappto/protocol`. Hosts hand it a database path and a list of harness adapters; clients talk to it through `request()` and `subscribe()`.

Internally the Runtime is four collaborators:

- The request router dispatches the protocol methods (`project.add`, `workspace.create`, `pack.import`, `settings.update`, `turn.start`, `approval.resolve`, and so on) and wraps results in the protocol's `{ ok, data | error }` envelope. It also owns pack directories on disk: app-created packs live under the host's `packsPath`, imported ones are registered in place.
- The harness registry tracks the installed adapters, probes their availability on a timer (every 5 minutes by default), persists which ones the user enabled, and resolves execution profiles against each harness's model catalog.
- The turn coordinator runs a turn: it persists the user message first, starts a harness session, then consumes the session's event stream and turns it into stored messages, activities, and approvals. Assistant text is stored in segments so tool rows land between the prose they interrupted, and messages and activities share a per-turn ordinal. High-frequency changes and approval state go out as sequenced `thread.delta` events an open view applies in place; other lifecycle transitions emit `thread.changed` and a full reload. On a Thread's first Turn it also starts an independent title generation call; failure leaves the `New task` seed in place and never blocks the Turn.
- The store persists everything in SQLite through Node's built-in `node:sqlite`, with WAL mode and migrations versioned by `PRAGMA user_version`. On startup, `recoverInterrupted()` marks turns that were running when the process died as failed, so the app never reopens into a phantom "running" state.

## Harness adapters

Two adapters ship in `src/harnesses/`, both implementing the `HarnessAdapterFactory` contract from `@openappto/harness-sdk`:

- `ClaudeAdapter` drives Claude Code through `@anthropic-ai/claude-agent-sdk`. It streams partial messages as `message.delta`, classifies tool use into typed activities (TodoWrite becomes the turn's plan, Task becomes a subagent, edits become file changes, and `parent_tool_use_id` nests a subagent's work under it), routes permission checks through `canUseTool` so they surface as approvals, and resumes sessions via the stored provider session id. Pack skill roots become generated local plugins (a manifest plus a symlink, with MCP discovery off).
- `CodexAdapter` spawns `codex app-server` and speaks JSON-RPC over JSONL. It maps item events to typed activities, including the plan items it used to drop, forwards command and file-change approval requests, and cancels with `turn/interrupt`. Pack skill roots go through the `skills/extraRoots/set` RPC, best effort: a codex version without it degrades silently.

Both built-in adapters also opt into stateless text generation for small app-owned text such as Thread titles. These calls use an approval-required profile, deny any tool request, and are not stored as Thread messages or resumable provider sessions.

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
