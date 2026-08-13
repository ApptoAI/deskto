# ADR 0003: Keep local execution independent from the future Hub

- Status: accepted
- Date: 2026-08-13

## Context

The application should work after download with existing Claude Code or Codex credentials. Teams may later want one source for skills, prompts, MCP configuration, tools, and starter projects. That distribution problem differs from executing a task.

## Decision

The MVP stores application state in SQLite and runs work in the selected local Workspace. It needs no account or server.

A future Hub will distribute versioned Packs through a Catalog. A Runtime may connect to a Hub and resolve an Execution Profile from local settings, installed Packs, and organization policy. The Hub will not own Thread execution or replace the Runtime API.

## Consequences

- Offline and individual use remain first-class.
- A company can later self-host a Hub without forcing its desktop clients to use remote execution.
- Pack manifests, trust, signing, policy precedence, and updates stay out of the MVP until their use cases are known.
