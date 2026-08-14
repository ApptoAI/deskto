# ADR 0008: Typed activities and thread deltas

- Status: accepted
- Date: 2026-08-14

## Context

Activities were flat `{ name, detail, status }` rows. That shape could not hold
the things harnesses already report: Codex emits plan and reasoning items that
the adapter dropped for lack of a place, and the Claude adapter flattened
TodoWrite, Task, and file edits into one text line even though it already
parses `parent_tool_use_id`, the key that links a subagent's work to the tool
call that spawned it. The UI also refetched the whole `ThreadView` on every
`thread.changed`, up to about twenty times a second while text streamed, which
caps how much data a view can carry.

## Decision

An Activity gains a provider-neutral `kind` payload: `tool` (command, search,
web, mcp, other), `file-change` with a path list, `plan` with steps, or
`subagent`. It also gains `parentActivityId` for nesting and an `ordinal`
shared with messages, so prose and tool work interleave in the order they
happened. The Harness SDK adds `activity.updated`, because plans change while
they run and a started/completed pair cannot express that. Adapters classify
their native items into these kinds; raw tool payloads stay out, keeping the
bounded-summary rule from ADR 0005. Reasoning items stay out too, for the same
rule, until a product use case appears.

Assistant text is stored in segments: when a top-level activity starts after
prose, the open message closes and later prose opens a new one.

High-frequency changes reach open views as `thread.delta` events carrying the
changed record and a per-thread sequence number. A client applies a delta only
when it extends the view it holds by exactly one; anything else falls back to
`thread.get`. Approval requests and resolutions also travel as deltas because
they contain the complete pending-approval and Thread status changes. Other
lifecycle transitions (turn start and completion) keep signaling
`thread.changed` and a full reload. The sequence counter lives in Runtime
memory; a restart re-baselines clients through the reload they do anyway.

## Consequences

- Claude and Codex plans, subagents, and file changes now reach the UI, and a
  fleet of subagent tool calls nests under its parent row instead of flooding
  the chat.
- Streaming no longer costs a full view refetch per flush. SQLite remains the
  source of truth and events still only make an open view current, so ADR 0004
  stands.
- Databases written before this change render as before: rows without a
  payload or ordinal fall back to the old layout.
- Payloads a newer build writes are ignored, not fatal, in an older build.
- Terminal output, diffs beyond path lists, and browser activity remain
  deferred until they have a product use case.
