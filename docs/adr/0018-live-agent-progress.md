# ADR 0018: Live agent progress

- Status: accepted
- Date: 2026-08-18

## Context

Claude can spend minutes streaming the JSON input of a tool call before its
complete `tool_use` message arrives. Codex similarly emits reasoning deltas
between visible messages and tools. The adapters discarded both kinds of
signal, so healthy work, a stalled provider, and a stuck session start all
looked like the same generic working indicator.

Files had a second delay. The Runtime could capture an Artifact while a Turn
was running, but the conversation intentionally hid its button until the final
answer.

## Decision

Harnesses emit `progress.updated` with a bounded stage and label. The event is
liveness only. It never contains reasoning, tool arguments, or tool output.
The Runtime trims labels, caps them at 120 characters, keeps the latest
progress in memory, includes it in an active `ThreadView`, and emits it through
the sequenced delta stream at most once per second for an unchanged stage.

Claude starts a placeholder Activity from `content_block_start`, then updates
it when the full tool input arrives. Thinking and partial tool-input deltas act
as heartbeats. Codex reasoning and tool-output deltas do the same without
exposing their contents. Silent Codex app-server requests fail after 30
seconds.

The working indicator shows the current label and reports how long the Runtime
has gone without a provider signal. Captured Turn Outputs appear during a
running Turn and move below the final answer when it settles.

## Consequences

- A large generated file has a visible preparing state before its write call
  is complete.
- Users can distinguish active work from a provider that stopped sending
  events.
- Progress disappears on completion, cancellation, failure, or process
  restart. It does not become transcript history.
- The Files view and conversation can show a deliverable before the agent has
  finished verification.
