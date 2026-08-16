# @deskto/protocol

The wire contract between a Client and the Runtime. This package defines every request the Runtime accepts, the shape of its responses and events, and the domain records both sides share. Client and Runtime depend on it; it depends only on zod.

## Why it exists

The desktop app talks to the Runtime over Electron IPC today. A hosted Runtime could use HTTP and WebSocket later. Keeping the protocol in its own package means both sides agree on one set of serializable types, and a new transport changes nothing about the messages themselves. Everything here is plain JSON-safe data: timestamps are ISO strings, there are no classes, and no Node or Electron imports.

## What is in it

Domain records, defined as zod schemas with types inferred from them:

- `Workspace`, a container of projects with a name, color, icon, and ordering; every install has a non-deletable `personal` workspace
- `Project`, a folder opened as a project, belonging to exactly one workspace
- `Pack`, a directory of skills the user manages in the app, attachable to many workspaces
- `Thread`, a task inside a project, with its status and execution profile
- `Message`, `Activity`, and `Approval`, the things a thread displays. An Activity may carry a typed payload (`tool`, `file-change`, `plan`, or `subagent`), a `parentActivityId` for work nested under a subagent, and an `ordinal` shared with messages so both interleave chronologically
- `Harness`, an agent product with its availability and model catalog
- `ThreadView`, the aggregate most calls return: the thread plus its messages, activities, any pending approval, and a `seq` delta cursor
- `ExecutionProfile`, `Preferences`, and `Selection` (the last active workspace and project, so a restart reopens them)
- `SettingsSnapshot`, the effective user settings: every value in effect plus the subset the user overrode. Values are opaque JSON here; both sides read them through `@deskto/settings`

Requests are one discriminated union, `runtimeRequestSchema`, keyed on `method`. The groups are `harness.*` (list, setEnabled, refresh), `preferences.get`, `settings.*` (get, update), `workspace.*` (list, create, update, delete, setPack), `selection.*` (get, set), `pack.*` (list, create, import, remove), `project.*` (list, add, move), `thread.*` (list, create, configure, get), `turn.*` (start, cancel), and `approval.resolve`. The Runtime validates incoming requests with this schema at the IPC boundary.

Responses are typed through the `RuntimeResponses` map. Every call resolves to `{ ok: true, data }` or `{ ok: false, error: { code, message } }`, so transport code never throws domain errors.

Events are a second discriminated union: `thread.changed` (with a `threadId`), `thread.delta`, `harness.changed`, `settings.changed`, `workspace.changed`, and `pack.changed`. Most events carry no payloads beyond the id and tell an open view to refetch. `thread.delta` is the exception for the high-frequency stream of a running turn: it carries one changed record (`message.appended`, `message.upserted`, `activity.upserted`, `approval.requested`, `approval.resolved`, or `thread.updated`) plus a per-thread `seq`. A client applies a delta only when its seq extends the view's cursor by exactly one; any gap means a refetch. Approval requests and resolutions apply incrementally; lifecycle transitions such as turn start and completion stay on `thread.changed`.

The `RuntimeTransport` interface ties it together: `request()` for calls and `subscribe()` for events. The Runtime implements it in-process and the desktop app implements it over IPC.

## Adding a method

Add the request schema to the union, add its return type to `RuntimeResponses`, then implement it in the Runtime's request router. The Client picks up the types automatically.
