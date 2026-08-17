# ADR 0017: Local MCP thread orchestration

- Status: accepted
- Date: 2026-08-17

## Context

A Harness can delegate work inside its own provider, but that work is not a
Deskto Thread. It cannot use another installed Harness, survive as a visible
task, or search prior work stored by the Runtime. Non-technical users also
cannot be expected to install an MCP server, choose a port, copy tokens, or
edit Claude Code and Codex configuration files.

MCP 2026-07-28 makes the HTTP core stateless and keeps compatibility concerns
inside the official SDK. Claude Code and Codex still differ in how a process is
given an MCP server. That provider detail belongs in their Harness Adapters.

## Decision

`packages/mcp-server` exposes Runtime thread operations as an in-process MCP
server. The Electron main process starts it on an ephemeral localhost port and
stops it with the Runtime. It uses the official TypeScript MCP v2 server and
Node packages, serves the current 2026-07-28 protocol, and accepts the SDK's
stateless 2025 compatibility path for installed Harness versions that have not
migrated yet.

Every Harness Turn receives a fresh bearer token and a binding to its Thread,
Project, and Workspace. Codex gets process-local `-c` overrides and a token
environment variable. Claude Code gets the equivalent HTTP MCP configuration
through its SDK options. Nothing is written to the user's global Harness
configuration.

The server provides tools to:

- inspect the current Deskto context and available Harnesses;
- create and start a bounded batch of child Threads;
- list, read, continue, cancel, and wait for child Threads;
- search titles and messages in the current Project, Workspace, or every local
  Workspace.

A child Thread belongs to the same Project and records `parentThreadId`.
Delegation is limited to eight direct children and two levels. Write tools can
only act on the token's current Thread tree. Read and search tools may inspect
other local Threads because cross-task recall is an explicit product feature.
Deleting a parent deletes its child Threads through the existing durable
Runtime ownership model.

Full-text search uses a SQLite FTS5 projection maintained by migrations and
triggers. The Client still receives complete state through Runtime queries.
MCP never talks to SQLite directly.

The HTTP server binds to `127.0.0.1`, validates Host and Origin, and requires a
random token on every request. The Runtime revokes each token when its Turn
settles. Tokens also expire after twelve hours as a hard upper bound and disappear
when the app closes.

The Surface shows child Threads as Background tasks in the parent's Activity
column and panel. They are also nested below their parent in the sidebar. A
child opens as a normal task, so its conversation, approvals, files, and
failure state use existing UI rather than a second orchestration interface.

## Consequences

- Delegated work is durable, visible, searchable, cancellable, and independent
  of one provider's native subagent format.
- A user installs Deskto and signs into a supported Harness. There is no MCP
  setup screen or manual configuration step.
- Provider-specific MCP configuration remains in Harness Adapters.
- Runtime protocol, storage, and events remain the source of truth.
- Search covers local message content, so it must not be exposed remotely
  without a separate authorization and privacy decision.
- The depth and fan-out limits are deliberate guardrails, not settings.
