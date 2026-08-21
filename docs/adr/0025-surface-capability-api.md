# ADR 0025: Surface capability API

- Status: accepted
- Date: 2026-08-21

## Context

Desktop navigation, Task Panel state, and Browser operations were reached
through unrelated React callbacks and module functions. Adding another trigger
for the same intent, such as a task menu, shortcut, or side task, would copy
both actions and availability rules. The Runtime protocol is the wrong home for
these operations because opening a screen or panel belongs to one Surface and
does not change durable application state.

## Decision

The Desktop Surface owns a renderer-local `SurfaceApi`. It groups capabilities
by what they operate: navigation, the Task Panel, Files, Activities, Browser,
and commands. Components still own rendering. The API coordinates which
Surface is visible and delegates Browser host operations to the existing narrow
preload bridge.

A command has a stable string id, person-facing metadata, an optional
availability predicate, and a handler. Buttons, menus, and keybindings may
execute the same command. Commands call Surface capabilities rather than
becoming a second implementation of them.

The API is an internal composition boundary. It does not load third-party code,
expose the Runtime Client or raw Electron bridge, add arbitrary UI slots, or
turn Packs into executable extensions. Durable operations still go through the
Client and Runtime. MCP remains a Runtime-to-Harness capability rather than a
Surface capability.

## Consequences

- Browser, Files, Activities, and navigation have one programmatic entry point
  regardless of which component or command initiated them.
- Task Panel visibility and place are scoped by Thread, ready for more than one
  task to be visible without relying on whichever component mounted last.
- Availability policy travels with a command instead of each trigger.
- Stable command ids can later back configurable shortcuts and discovery.
- A public plugin API still requires a separate decision about trust,
  capabilities, isolation, versioning, and distribution.
