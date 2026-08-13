# ADR 0004: Store current state in SQLite

- Status: accepted
- Date: 2026-08-13

## Context

The local Runtime needs durable projects, tasks, messages, approvals, and provider session identifiers. Electron already embeds a Node version with `node:sqlite`. Replaying every provider delta would add an event store without an MVP use case.

## Decision

The Runtime owns one `node:sqlite` connection. Desktop chooses the database path under Electron's user data directory. Runtime operations write current state in transactions. Streamed text is buffered briefly before updating the current assistant message.

Clients reload a complete Thread view after a `thread.changed` notification. The notification is an invalidation signal, not a durable event. On startup, the Runtime marks unfinished Turns as interrupted instead of replaying tools or continuing work on its own.

## Consequences

- The MVP has no native SQLite addon or Electron rebuild step for its database.
- Reconnect and restart use ordinary queries instead of event replay.
- Long migrations and high write volume would block the Electron main process. Move database work off that process only after measurements show a need.
- Audit logs and multi-writer hosted execution need a separate decision later.
