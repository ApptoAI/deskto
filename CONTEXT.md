# Product context

## Purpose

This application gives non-technical users a desktop place to hand work to local AI agents. A user opens a folder as a project, starts a task, chooses Claude or Codex, and follows the result in a chat.

The first release is local and small. It has an Electron client, a Node runtime, SQLite storage, Markdown messages, approvals, cancellation, and resumable agent sessions. It does not contain team administration, automation, a hosted service, or a marketplace.

## Glossary

- **Surface**: A user-facing application. Desktop is the only Surface in the MVP. Web and mobile may follow.
- **Client**: Surface-side code that calls the Runtime through a transport. It does not import Node, SQLite, Electron, or a provider SDK.
- **Runtime**: The application service that owns projects, threads, turns, persistence, and Harness sessions.
- **Environment**: A place where a Runtime runs and where work executes. The MVP has one local Environment inside the Electron main process.
- **Connection**: Client configuration for reaching an Environment. Desktop uses Electron IPC. A future hosted Runtime can use HTTP and WebSocket without changing Client use cases.
- **Workspace**: A container of Projects for one area of life or work, modeled on Arc browser Spaces. It owns a name, color, icon, its attached Packs, and the last active Project. Every install has a non-deletable Personal Workspace.
- **Project**: A folder the user has opened as a project. It belongs to exactly one Workspace. Use "project" in UI copy and `Project` in code.
- **Thread**: A task and its conversation inside one Project. Use "task" in UI copy and `Thread` in code.
- **Turn**: One user request and one Harness execution in a Thread.
- **Activity**: A bounded summary of one unit of Harness work inside a Turn. Its kind is provider-neutral: a tool call, a file change, a working plan, or a subagent. Subagent work nests under the Activity that spawned it.
- **Harness**: An agent product that performs work, such as Claude Code or Codex.
- **Harness SDK**: The provider-neutral package that defines Harness descriptors, sessions, events, approvals, and test helpers.
- **Harness Adapter**: Runtime code that maps one Harness protocol into the Harness SDK contract.
- **Execution Profile**: The model, thinking level, and permission mode used by a Harness. A Thread owns the editable profile; every Turn stores the profile it started with.
- **Pack**: An app-managed directory of skills that can be created locally or imported and attached to multiple Workspaces. Prompts, MCP configuration, templates, tool requirements, and versioning may follow.
- **Catalog**: A future list of Packs available to a person or organization.
- **Hub**: A future service that publishes Catalogs and Packs. A Hub does not execute Threads.

## Core rules

- A Project points to one folder, belongs to one Workspace, and owns its Threads.
- Deleting a Workspace moves its Projects to the Personal Workspace. Nothing on disk is touched.
- A Thread uses one Harness. Its provider session identifier stays in Runtime storage and never becomes a Client concern.
- A Thread's Execution Profile can change only between Turns. Available models and thinking levels come from its Harness rather than a shared hardcoded catalog.
- The Runtime persists user messages before starting a Harness.
- The Runtime converts provider output into Harness SDK events before it reaches the Client.
- Permission modes have common product meaning. Harness Adapters own their provider-specific security mapping.
- Tool activity shown in a Thread is a bounded summary, not a transcript or an audit log.
- The Client rebuilds current state from Runtime queries. Runtime events only make an open view current: high-frequency changes arrive as sequenced thread deltas, and any gap falls back to a query.
- Local use never requires a Hub or an account.
- Provider-specific types stay inside their Harness Adapter.

## Package boundaries

- `packages/harness-sdk` has pure TypeScript contracts and test helpers. It has no provider, Electron, database, or UI dependencies.
- `packages/protocol` defines serializable Runtime requests, responses, events, and domain records.
- `packages/settings` defines every user-configurable setting: its key, schema, default value, and editor kind. The Runtime stores only overrides; defaults stay in the registry.
- `packages/client` wraps a transport with task-oriented methods for any Surface.
- `packages/runtime` implements use cases, SQLite persistence, and built-in Harness Adapters.
- `packages/ui` contains reusable DOM components. It does not call Electron or the Runtime.
- `apps/desktop` hosts the Runtime in Electron main, exposes a narrow preload bridge, and composes the React Surface.

## Deliberately deferred

- Web and mobile Surfaces
- A remotely hosted Runtime
- Authentication and team administration
- Hub, Catalog, remote Pack distribution, and policy enforcement
- MCP and CLI provisioning
- Starter project distribution
- Search, pinning, inbox, automation, and usage screens

The boundaries above reserve a place for these features. They do not justify placeholder services or UI in the MVP.
