# @openappto/protocol

The wire contract between a Client and the Runtime. This package defines every request the Runtime accepts, the shape of its responses and events, and the domain records both sides share. Client and Runtime depend on it; it depends only on zod.

## Why it exists

The desktop app talks to the Runtime over Electron IPC today. A hosted Runtime could use HTTP and WebSocket later. Keeping the protocol in its own package means both sides agree on one set of serializable types, and a new transport changes nothing about the messages themselves. Everything here is plain JSON-safe data: timestamps are ISO strings, there are no classes, and no Node or Electron imports.

## What is in it

Domain records, defined as zod schemas with types inferred from them:

- `Workspace`, a folder opened as a project
- `Thread`, a task inside a workspace, with its status and execution profile
- `Message`, `Activity`, and `Approval`, the things a thread displays
- `Harness`, an agent product with its availability and model catalog
- `ThreadView`, the aggregate most calls return: the thread plus its messages, activities, and any pending approval
- `ExecutionProfile` and `Preferences`
- `SettingsSnapshot`, the effective user settings: every value in effect plus the subset the user overrode. Values are opaque JSON here; both sides read them through `@openappto/settings`

Requests are one discriminated union, `runtimeRequestSchema`, keyed on `method`. There are 15 methods across seven groups: `harness.*` (list, setEnabled, refresh), `preferences.get`, `settings.*` (get, update), `workspace.*` (list, add), `thread.*` (list, create, configure, get), `turn.*` (start, cancel), and `approval.resolve`. The Runtime validates incoming requests with this schema at the IPC boundary.

Responses are typed through the `RuntimeResponses` map. Every call resolves to `{ ok: true, data }` or `{ ok: false, error: { code, message } }`, so transport code never throws domain errors.

Events are a second discriminated union with three members: `thread.changed` (with a `threadId`), `harness.changed`, and `settings.changed`. Events carry no payloads beyond the id. They tell an open view to refetch; they are not a data stream.

The `RuntimeTransport` interface ties it together: `request()` for calls and `subscribe()` for events. The Runtime implements it in-process and the desktop app implements it over IPC.

## Adding a method

Add the request schema to the union, add its return type to `RuntimeResponses`, then implement it in the Runtime's request router. The Client picks up the types automatically.
